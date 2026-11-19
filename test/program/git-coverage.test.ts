// Every git command the Program entry points run gets the clean
// environment and the three overrides (plan B11b). The production entry
// points are `worktreeProgramWith(startGit)`. The first test drives that
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
// `worktreeProgramWith(startGit)`, with `startGit` from `runtime/git.ts`.
import { describe, expect, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
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
    const program = worktreeProgramWith(recordingStart(calls))(emptyHome)
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
      ["rev-parse", "--verify", "--quiet", "refs/heads/foreman/t"],
      ["worktree", "add", "--lock", "--reason", "foreman", "-b", "foreman/t", "--", path, created.base],
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
    expect(calls.map((each) => each.env)).toEqual(
      calls.map(() => ({
        PATH: "/usr/bin:/bin",
        HOME: emptyHome,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_ATTR_SOURCE: "4b825dc642cb6eb9a060e54bf8d69288fbe24904",
      })),
    )
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
    const reference = yield* worktreeProgramWith(startGit)(home).createWorktree(request("reference"))
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

/** The text of `src/program/worktree.ts`. */
const programSource =
  Object.values(
    import.meta.glob<string>("../../src/program/worktree.ts", { query: "?raw", import: "default", eager: true }),
  )[0] ?? ""

/** Whether an import declaration binds the local name `startGit`. */
const bindsStartGit = (statement: ts.ImportDeclaration) => {
  const bindings = statement.importClause?.namedBindings
  return (
    bindings !== undefined &&
    ts.isNamedImports(bindings) &&
    bindings.elements.some((element) => element.name.text === "startGit")
  )
}

/** The initializer of the exported `worktreeProgram`, and where `startGit` is imported from. */
const productionDefinition = (text: string) => {
  const file = ts.createSourceFile("worktree.ts", text, ts.ScriptTarget.ES2022, true)
  const initializers = file.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => statement.declarationList.declarations)
    .filter((declaration) => declaration.name.getText() === "worktreeProgram")
    .map((declaration) => declaration.initializer?.getText() ?? "")
  const startGitSources = file.statements
    .filter(ts.isImportDeclaration)
    .filter(bindsStartGit)
    .map((statement) => statement.moduleSpecifier.getText())
  return { initializers, startGitSources }
}

describe("Program's git commands", () => {
  it("defines production as the factory over startGit and nothing else", () => {
    expect(productionDefinition(programSource)).toEqual({
      initializers: ["worktreeProgramWith(startGit)"],
      startGitSources: ['"../runtime/git.ts"'],
    })
  })

  it("the production-definition check refuses a wrapped startGit or a hand-built program", () => {
    const wrapped = `import { startGit } from "../runtime/git.ts"\nexport const worktreeProgram = worktreeProgramWith((i) => startGit(i))`
    const handBuilt = `import { startGit } from "../runtime/git.ts"\nexport const worktreeProgram = (home: string) => ({ ...worktreeProgramWith(startGit)(home) })`
    const renamed = `import { startGit as other } from "../runtime/git.ts"\nimport { startGit } from "./elsewhere.ts"\nexport const worktreeProgram = worktreeProgramWith(startGit)`
    expect(productionDefinition(wrapped).initializers).not.toEqual(["worktreeProgramWith(startGit)"])
    expect(productionDefinition(handBuilt).initializers).not.toEqual(["worktreeProgramWith(startGit)"])
    expect(productionDefinition(renamed).startGitSources).not.toEqual(['"../runtime/git.ts"'])
  })

  it.effect("creation and the startup check run every git command clean, with the overrides first", () =>
    withRepo(createdAndIdentified))

  it.effect("the production entry points run git with the same environment as the factory over startGit", () =>
    withRepo(productionMatchesFactory))
})
