// Process gate (plan B11b; owner ruling on A1, 2026-11-19): only four
// modules in src/ can start a process, named by path: `src/runtime/git.ts`
// (git), `spawn.ts` (clients), `processes.ts` (`ps`) and
// `client-version.ts` (`<client> --version`). Every `execFile` and
// `spawn` call, in any module, gives an explicit environment, and only
// git.ts passes "git" as the program, so no production path runs git with
// the parent's environment or outside the clean runners. Decided on the
// TypeScript syntax tree, not on text.
//
// What counts as starting a process or reading the parent environment:
// importing, re-exporting, `import()`ing or `require()`ing
// `node:child_process`, `child_process`, `node:cluster` or `bun`; any
// reference to the `Bun` or `process` globals. A module with a syntax
// error fails outright, since its tree may not show all its code.
//
// Blind spots: a process started through another module this gate does
// not name (a native addon, a worker that imports child_process,
// `bun:ffi`), a specifier computed at run time, and an `execFile` or
// `spawn` reached through an alias such as `const run = execFile` or a
// namespace import (`childProcess.spawn`). The git-program rule sees only
// a literal "git" as the first argument: a program held in a variable,
// a path such as "/usr/bin/git", or argv chosen at run time (as spawn.ts
// and client-version.ts take theirs) escapes it, so a client launch whose
// argv starts with git is not caught here. It also cannot see a
// module that imports `startGit` from git.ts and passes it an environment
// other than the clean one. On the paths that creation and the startup
// check take, `test/program/git-coverage.test.ts` catches that, because
// the bypassed command drops out of its recorded sequence; on any other
// path nothing does. The must-fail cases below show what this gate
// detects.
import { describe, expect, it } from "@effect/vitest"
import ts from "typescript"

const sources = import.meta.glob<string>("../../src/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
})

/** The one module that may start git. */
const gitModule = "../../src/runtime/git.ts"

/** The modules that may start a process (owner ruling on A1). */
const processStarters = [
  gitModule,
  "../../src/runtime/spawn.ts",
  "../../src/runtime/processes.ts",
  "../../src/runtime/client-version.ts",
]

/** The calls that start a process and take an options object third. */
const processCalls = ["execFile", "spawn"]

const processModules = ["node:child_process", "child_process", "node:cluster", "cluster", "bun"]

const processGlobals = ["Bun", "process"]

/** The string a module specifier or call argument names, if it is a literal. */
const literalText = (node: ts.Node | undefined) =>
  node !== undefined && ts.isStringLiteralLike(node) ? [node.text] : []

/** Module names a node imports, re-exports, `import()`s or `require()`s. */
const importedBy = (node: ts.Node): ReadonlyArray<string> => {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return literalText(node.moduleSpecifier)
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference))
    return literalText(node.moduleReference.expression)
  if (ts.isCallExpression(node)) {
    const dynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword
    const required = ts.isIdentifier(node.expression) && node.expression.text === "require"
    return dynamic || required ? literalText(node.arguments[0]) : []
  }
  return []
}

/** Whether an identifier is a reference to a global, not a property name or declaration. */
const isGlobalReference = (node: ts.Identifier) => {
  const parent = node.parent
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false
  if (ts.isImportSpecifier(parent) || ts.isPropertySignature(parent)) return false
  return processGlobals.includes(node.text)
}

/** The name of a process call (`execFile` or `spawn`) by identifier, if the call is one. */
const processCallName = (node: ts.CallExpression): ReadonlyArray<string> =>
  ts.isIdentifier(node.expression) && processCalls.includes(node.expression.text) ? [node.expression.text] : []

/** Whether a process call's program (first argument) is the literal "git". */
const runsGit = (node: ts.CallExpression) =>
  processCallName(node).length > 0 && literalText(node.arguments[0]).includes("git")

/** Whether a process call's options object (third argument) has no `env` property. */
const isProcessCallWithoutEnv = (node: ts.CallExpression) => {
  const options = node.arguments[2]
  if (options === undefined || !ts.isObjectLiteralExpression(options)) return true
  return !options.properties.some(
    (property) =>
      (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
      ts.isIdentifier(property.name) &&
      property.name.text === "env",
  )
}

/** Every node of a parsed module, depth first. */
const nodesOf = (text: string): ReadonlyArray<ts.Node> => {
  const file = ts.createSourceFile("module.ts", text, ts.ScriptTarget.ES2022, true)
  const found: Array<ts.Node> = []
  const visit = (node: ts.Node): void => {
    found.push(node)
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

/**
 * The syntax errors TypeScript reports for a module, as findings. A module
 * that does not parse may hold code the syntax tree does not show, so the
 * gate fails it rather than judge a partial tree.
 */
const parseFindings = (text: string): ReadonlyArray<string> =>
  (
    ts.transpileModule(text, {
      reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).diagnostics ?? []
  ).map((diagnostic) => `does not parse: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`)

/**
 * What a module does that the gate forbids: a syntax error, a process
 * module imported (unless `mayStartProcesses`), a process global
 * referenced, an `execFile` or `spawn` call without an explicit `env`,
 * or "git" as such a call's program (unless `mayRunGit`).
 */
export const processFindings = (
  text: string,
  mayStartProcesses: boolean,
  mayRunGit: boolean,
): ReadonlyArray<string> => [
  ...parseFindings(text),
  ...nodesOf(text).flatMap((node) => [
    ...importedBy(node)
      .filter((name) => processModules.includes(name) && !mayStartProcesses)
      .map((name) => `imports ${name}`),
    ...(ts.isIdentifier(node) && isGlobalReference(node) ? [`references ${node.text}`] : []),
    ...(ts.isCallExpression(node) && isProcessCallWithoutEnv(node)
      ? processCallName(node).map((name) => `${name} without env`)
      : []),
    ...(ts.isCallExpression(node) && !mayRunGit && runsGit(node) ? ["runs git outside git.ts"] : []),
  ]),
]

/** The number of calls named `name` in a module. */
const callsNamed = (name: string, text: string) =>
  nodesOf(text).filter(
    (node) => ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name,
  ).length

describe("only the four process modules start a process, always with an explicit environment", () => {
  it.each([
    [gitModule, 1, 0],
    ["../../src/runtime/spawn.ts", 0, 1],
    ["../../src/runtime/processes.ts", 1, 0],
    ["../../src/runtime/client-version.ts", 1, 0],
  ])("scans %s with its process calls (scan minimum)", (path, execFiles, spawns) => {
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(40)
    expect(callsNamed("execFile", sources[path] ?? "")).toBe(execFiles)
    expect(callsNamed("spawn", sources[path] ?? "")).toBe(spawns)
  })

  it.each(Object.entries(sources))("%s", (path, text) => {
    expect(processFindings(text, processStarters.includes(path), path === gitModule)).toEqual([])
  })
})

describe("process gate must-fail cases", () => {
  it.each([
    ["an import", `import { execFile } from "node:child_process"`, ["imports node:child_process"]],
    ["an unprefixed import", `import { spawn } from "child_process"`, ["imports child_process"]],
    ["a type-only import", `import type { ChildProcess } from "node:child_process"`, ["imports node:child_process"]],
    ["a re-export", `export { spawn } from "bun"`, ["imports bun"]],
    ["a dynamic import", `const cp = await import("node:child_process")`, ["imports node:child_process"]],
    ["a require", `const cp = require("child_process")`, ["imports child_process"]],
    ["the Bun global", `Bun.spawn(["git"])`, ["references Bun"]],
    ["the parent environment", `const home = process.env.HOME`, ["references process"]],
  ])("flags %s outside git.ts", (_name, text, expected) => {
    expect(processFindings(text, false, false)).toEqual(expected)
  })

  it.each([
    ["an unclosed import list", `import { execFile from "node:child_process"`],
    ["an unterminated string", `const program = "git`],
    ["a stray brace", `export const run = () => { startGit() }}`],
  ])("flags a module that does not parse: %s", (_name, text) => {
    expect(processFindings(text, true, true).filter((finding) => finding.startsWith("does not parse:"))).not.toEqual([])
  })

  it.each([
    ["no options", `execFile("git", [], cb)`],
    ["options without env", `execFile("git", [], { cwd, encoding: "utf8" }, cb)`],
    ["options passed by name", `execFile("git", [], options, cb)`],
  ])("flags execFile with %s, even in git.ts", (_name, text) => {
    expect(processFindings(text, true, true)).toEqual(["execFile without env"])
  })

  it.each([
    ["no options", `spawn("claude", [])`],
    ["options without env", `spawn("claude", [], { cwd, detached: true })`],
    ["options passed by name", `spawn("claude", [], options)`],
  ])("flags spawn with %s, even in a module that may start processes", (_name, text) => {
    expect(processFindings(text, true, true)).toEqual(["spawn without env"])
  })

  it.each([
    ["execFile", `execFile("git", [], { cwd, env, encoding: "utf8" }, cb)`],
    ["spawn", `spawn("git", [], { cwd, env, detached: true, stdio })`],
  ])("flags git as the program of %s outside git.ts", (_name, text) => {
    expect(processFindings(text, true, false)).toEqual(["runs git outside git.ts"])
  })

  it.each([
    [
      "spawn.ts",
      `import { spawn } from "node:child_process"; const child = spawn(file, args, { cwd, env: launch.env, detached: true })`,
    ],
    ["processes.ts", `import { execFile } from "node:child_process"; execFile(ps, args, { cwd, env: listing }, cb)`],
    ["client-version.ts", `import { execFile } from "node:child_process"; execFile(client, args, { cwd, env }, cb)`],
  ])("passes a process start like %s's in a module that may start processes", (_name, text) => {
    expect(processFindings(text, true, false)).toEqual([])
  })

  it.each([
    `import { Effect } from "effect"`,
    `import { Database } from "bun:sqlite"`,
    `const env = { PATH: "/usr/bin:/bin" }; execFile("git", [], { cwd, env, encoding: "utf8" }, cb)`,
    `const value = record.process`,
  ])("passes %j in git.ts", (text) => {
    expect(processFindings(text, true, true)).toEqual([])
  })
})
