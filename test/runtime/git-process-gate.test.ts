// Process gate (plan B11b): `src/runtime/git.ts` is the only module in
// src/ that can start a process, and it gives every `execFile` call an
// explicit environment, so no production path runs git with the parent's
// environment. Decided on the TypeScript syntax tree, not on text.
//
// What counts as starting a process or reading the parent environment:
// importing, re-exporting, `import()`ing or `require()`ing
// `node:child_process`, `child_process`, `node:cluster` or `bun`; any
// reference to the `Bun` or `process` globals. Blind spots: a process
// started through another module this gate does not name (a native
// addon, a worker that imports child_process, `bun:ffi`), a specifier
// computed at run time, and an `execFile` reached through an alias such
// as `const run = execFile`. The must-fail cases below show what it
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

/** Whether a call is `execFile(...)` whose options object has no `env` property. */
const isExecFileWithoutEnv = (node: ts.CallExpression) => {
  if (!ts.isIdentifier(node.expression) || node.expression.text !== "execFile") return false
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
 * What a module does that the gate forbids: a process module imported
 * (unless `mayStartProcesses`), a process global referenced, or an
 * `execFile` call without an explicit `env`.
 */
export const processFindings = (text: string, mayStartProcesses: boolean): ReadonlyArray<string> =>
  nodesOf(text).flatMap((node) => [
    ...importedBy(node)
      .filter((name) => processModules.includes(name) && !mayStartProcesses)
      .map((name) => `imports ${name}`),
    ...(ts.isIdentifier(node) && isGlobalReference(node) ? [`references ${node.text}`] : []),
    ...(ts.isCallExpression(node) && isExecFileWithoutEnv(node) ? ["execFile without env"] : []),
  ])

/** The number of `execFile` calls in a module. */
const execFileCalls = (text: string) =>
  nodesOf(text).filter(
    (node) => ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "execFile",
  ).length

describe("only src/runtime/git.ts starts a process, always with an explicit environment", () => {
  it("scans the real tree, git.ts included (scan minimum)", () => {
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(40)
    expect(execFileCalls(sources[gitModule] ?? "")).toBe(1)
  })

  it.each(Object.entries(sources))("%s", (path, text) => {
    expect(processFindings(text, path === gitModule)).toEqual([])
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
    expect(processFindings(text, false)).toEqual(expected)
  })

  it.each([
    ["no options", `execFile("git", [], cb)`],
    ["options without env", `execFile("git", [], { cwd, encoding: "utf8" }, cb)`],
    ["options passed by name", `execFile("git", [], options, cb)`],
  ])("flags execFile with %s, even in git.ts", (_name, text) => {
    expect(processFindings(text, true)).toEqual(["execFile without env"])
  })

  it.each([
    `import { Effect } from "effect"`,
    `import { Database } from "bun:sqlite"`,
    `const env = { PATH: "/usr/bin:/bin" }; execFile("git", [], { cwd, env, encoding: "utf8" }, cb)`,
    `const value = record.process`,
  ])("passes %j in git.ts", (text) => {
    expect(processFindings(text, true)).toEqual([])
  })
})
