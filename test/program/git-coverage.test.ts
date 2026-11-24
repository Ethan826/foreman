// Every git command the Program entry points run gets the clean
// environment and the three overrides (plan B11b), and the startup
// attribute check's commands also get the recorded worktree's GIT_DIR,
// GIT_WORK_TREE and GIT_COMMON_DIR (plan B11d). The production entry
// points are `worktreeProgramWith(startGit, noAttributeAllowance)`. The
// first test drives that
// same factory over a recording process call, which passes each
// invocation on to the real one, so creation and the startup check run
// against a real repository while every invocation is kept. The second
// observes the production `worktreeProgram` itself: a smudge filter that
// `$HOME/.config/git/attributes` declares is `/usr/bin/env`, so the
// checked-out file holds the environment git ran with. It must match the
// factory over the real `startGit`, so production passes `startGit` and
// nothing else. B11c refuses `info/attributes` and a repository
// `core.attributesFile`, so the probe uses git's default attributes file
// under the injected HOME, which the clean environment leaves in force
// and the attribute check does not read.
// No git command of the startup check runs a program git could report
// its environment through, so the third test pins the production
// definition on the syntax tree: `worktreeProgram` is exactly
// `worktreeProgramWith(startGit, noAttributeAllowance)`, with `startGit`
// from `runtime/git.ts` and `noAttributeAllowance` from
// `domain/attributes.ts` (decision M09: production passes the empty
// allowance).
import { describe, expect, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { noAttributeAllowance } from "../../src/domain/attributes.ts"
import { worktreeProgram, worktreeProgramWith } from "../../src/program/worktree.ts"
import { startGit, type GitInvocation, type StartGit } from "../../src/runtime/git.ts"
import ts from "typescript"
import { emptyHome, git, withRepo } from "../runtime/git-repo.ts"

/** The real process call, which first records each invocation in `calls`. */
const recordingStart =
  (calls: Array<GitInvocation>): StartGit =>
  (invocation) =>
    Effect.andThen(
      Effect.sync(() => {
        calls.push(invocation)
      }),
      startGit(invocation),
    )

const overrides = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "commit.gpgsign=false"]

/** The command after the overrides, or the whole args when they do not start with them. */
const command = (invocation: GitInvocation) =>
  startsWithOverrides(invocation) ? invocation.args.slice(overrides.length) : invocation.args

const startsWithOverrides = (invocation: GitInvocation) =>
  overrides.every((each, index) => invocation.args[index] === each)

/** Whether an invocation reads config: creation reads it in the owner's checkout, startup in the worktree. */
const isConfigRead = (invocation: GitInvocation) => command(invocation)[0] === "config"

const createdAndIdentified = (dir: string, owner: string) =>
  Effect.gen(function* () {
    writeFileSync(`${owner}/.gitattributes`, "# comments only\n")
    yield* git(owner, "add", ".gitattributes")
    yield* git(owner, "commit", "--quiet", "-m", "attributes")
    const blob = yield* git(owner, "rev-parse", "HEAD:.gitattributes")
    const calls: Array<GitInvocation> = []
    const program = worktreeProgramWith(recordingStart(calls), noAttributeAllowance)(emptyHome)
    const path = `${dir}/worktree`
    const created = yield* program.createWorktree({ ownerCheckout: owner, path, name: "t", start: Option.none() })
    yield* program.identifyWorktree(created)
    const attributeReads = [
      ["ls-tree", "--full-tree", "-r", "-t", "-z", created.base],
      ["cat-file", "blob", blob],
      ["config", "--get", "core.attributesFile"],
      ["config", "--get-regexp", "^includeif\\."],
    ]
    expect(calls.map(command)).toEqual([
      ["rev-parse", "HEAD"],
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      ...attributeReads,
      ["rev-parse", "--verify", "--quiet", "refs/heads/tarlatan/t"],
      ["worktree", "add", "--lock", "--reason", "tarlatan", "-b", "tarlatan/t", "--", path, created.base],
      ["rev-parse", "--show-toplevel"],
      ["rev-parse", "--symbolic-full-name", "HEAD"],
      ["rev-parse", "--absolute-git-dir"],
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      ["worktree", "list", "--porcelain", "-z"],
      ["rev-parse", "--absolute-git-dir"],
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      ...attributeReads,
    ])
    expect(calls.filter(isConfigRead).map((each) => each.cwd)).toEqual([owner, owner, created.path, created.path])
    expect(calls.filter((each) => !startsWithOverrides(each))).toEqual([])
    const clean = {
      PATH: "/usr/bin:/bin",
      HOME: emptyHome,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_ATTR_SOURCE: "4b825dc642cb6eb9a060e54bf8d69288fbe24904",
    }
    const pinned = { ...clean, GIT_DIR: created.gitDir, GIT_WORK_TREE: created.path, GIT_COMMON_DIR: created.commonDir }
    const unpinnedCount = calls.length - attributeReads.length
    expect(calls.map((each) => each.env)).toEqual([
      ...calls.slice(0, unpinnedCount).map(() => clean),
      ...attributeReads.map(() => pinned),
    ])
  })

/**
 * Commits `a.txt`, makes `/usr/bin/env` its smudge filter through
 * `<home>/.config/git/attributes`, and returns `home`, a new directory
 * under `dir`.
 */
const plantEnvironmentProbe = (dir: string, owner: string) =>
  Effect.gen(function* () {
    writeFileSync(`${owner}/a.txt`, "text\n")
    yield* git(owner, "add", "a.txt")
    yield* git(owner, "commit", "--quiet", "-m", "file")
    const home = `${dir}/probe-home`
    mkdirSync(home)
    mkdirSync(`${home}/.config`)
    mkdirSync(`${home}/.config/git`)
    writeFileSync(`${home}/.config/git/attributes`, "a.txt filter=probe\n")
    yield* git(owner, "config", "filter.probe.smudge", "/usr/bin/env")
    return home
  })

/**
 * The environment the smudge filter saw, as sorted lines, without
 * `GIT_DIR`, which git sets to the new worktree's own directory.
 */
const filterEnvironment = (worktree: string) =>
  readFileSync(`${worktree}/a.txt`, "utf8")
    .split("\n")
    .filter((line) => line !== "" && !line.startsWith("GIT_DIR="))
    .sort()

const productionMatchesFactory = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const home = yield* plantEnvironmentProbe(dir, owner)
    const request = (name: string) => ({ ownerCheckout: owner, path: `${dir}/${name}`, name, start: Option.none() })
    const production = yield* worktreeProgram(home).createWorktree(request("production"))
    const reference = yield* worktreeProgramWith(startGit, noAttributeAllowance)(home).createWorktree(request("reference"))
    yield* worktreeProgram(home).identifyWorktree(production)
    expect(filterEnvironment(production.path)).toEqual(filterEnvironment(reference.path))
    expect(filterEnvironment(production.path)).toEqual(
      expect.arrayContaining([
        `HOME=${home}`,
        "GIT_CONFIG_NOSYSTEM=1",
        "GIT_CONFIG_GLOBAL=/dev/null",
        "GIT_ATTR_SOURCE=4b825dc642cb6eb9a060e54bf8d69288fbe24904",
      ]),
    )
  })

/** The exact production definition's initializer. */
const productionInitializer = "worktreeProgramWith(startGit, noAttributeAllowance)"

/** The text of `src/program/worktree.ts`. */
const programSource =
  Object.values(
    import.meta.glob<string>("../../src/program/worktree.ts", { query: "?raw", import: "default", eager: true }),
  )[0] ?? ""

/** Whether an import declaration binds the local name `name`. */
const binds = (name: string) => (statement: ts.ImportDeclaration) => {
  const bindings = statement.importClause?.namedBindings
  return (
    bindings !== undefined &&
    ts.isNamedImports(bindings) &&
    bindings.elements.some((element) => element.name.text === name)
  )
}

/** The module specifiers of the imports in `file` that bind `name`. */
const sourcesOf = (file: ts.SourceFile, name: string) =>
  file.statements
    .filter(ts.isImportDeclaration)
    .filter(binds(name))
    .map((statement) => statement.moduleSpecifier.getText())

/**
 * The initializer of the exported `worktreeProgram`, and where `startGit`
 * and `noAttributeAllowance` are imported from.
 */
const productionDefinition = (text: string) => {
  const file = ts.createSourceFile("worktree.ts", text, ts.ScriptTarget.ES2022, true)
  const initializers = file.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => statement.declarationList.declarations)
    .filter((declaration) => declaration.name.getText() === "worktreeProgram")
    .map((declaration) => declaration.initializer?.getText() ?? "")
  return {
    initializers,
    startGitSources: sourcesOf(file, "startGit"),
    allowanceSources: sourcesOf(file, "noAttributeAllowance"),
  }
}

describe("Program's git commands", () => {
  it("defines production as the factory over startGit and the empty allowance, and nothing else", () => {
    expect(productionDefinition(programSource)).toEqual({
      initializers: [productionInitializer],
      startGitSources: ['"../runtime/git.ts"'],
      allowanceSources: ['"../domain/attributes.ts"'],
    })
  })

  it("the production-definition check refuses a wrapped startGit, a hand-built program or another allowance", () => {
    const imports = `import { startGit } from "../runtime/git.ts"\nimport { noAttributeAllowance } from "../domain/attributes.ts"\n`
    const wrapped = `${imports}export const worktreeProgram = worktreeProgramWith((i) => startGit(i), noAttributeAllowance)`
    const handBuilt = `${imports}export const worktreeProgram = (home: string) => ({ ...worktreeProgramWith(startGit, noAttributeAllowance)(home) })`
    const inline = `${imports}export const worktreeProgram = worktreeProgramWith(startGit, { rootLines: ["* filter=x"] })`
    const renamed = `import { startGit as other } from "../runtime/git.ts"\nimport { startGit } from "./elsewhere.ts"\nexport const worktreeProgram = worktreeProgramWith(startGit, noAttributeAllowance)`
    const allowanceElsewhere = `import { startGit } from "../runtime/git.ts"\nimport { noAttributeAllowance } from "./elsewhere.ts"\nexport const worktreeProgram = worktreeProgramWith(startGit, noAttributeAllowance)`
    expect(productionDefinition(wrapped).initializers).not.toEqual([productionInitializer])
    expect(productionDefinition(handBuilt).initializers).not.toEqual([productionInitializer])
    expect(productionDefinition(inline).initializers).not.toEqual([productionInitializer])
    expect(productionDefinition(renamed).startGitSources).not.toEqual(['"../runtime/git.ts"'])
    expect(productionDefinition(allowanceElsewhere).allowanceSources).not.toEqual(['"../domain/attributes.ts"'])
  })

  it.effect("every git command runs clean with the overrides first, and only the startup attribute reads are pinned", () =>
    withRepo(createdAndIdentified))

  it.effect("the production entry points run git with the same environment as the factory over startGit", () =>
    withRepo(productionMatchesFactory))
})
