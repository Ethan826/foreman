// The process gate's scanner (plan B11b; owner rulings on A1,
// 2026-11-19 and 2026-11-20), shared by the gate's two test files:
// git-process-gate.test.ts, which states the gate's rules and blind spots
// and scans every module in src/, and process-entry-gate.test.ts, which
// holds the CLI entry's exception and the ambient-declaration rule.
// Decided on the TypeScript syntax tree, not on text.
import ts from "typescript"

/** Every module in src/, by path relative to this directory, as text. */
export const sources = import.meta.glob<string>("../../src/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
})

/** The one module that may start git. */
export const gitModule = "../../src/runtime/git.ts"

/** The modules that may start a process (owner ruling on A1). */
export const processStarters = [
  gitModule,
  "../../src/runtime/spawn.ts",
  "../../src/runtime/processes.ts",
  "../../src/runtime/client-version.ts",
]

/**
 * The CLI's entry module (owner ruling on A1, 2026-11-19): the one module
 * that may reference `process`, and only as one of {@link entryMembers}.
 */
export const entryModule = "../../src/facade/main.ts"

/** What the entry module may read or call on `process`. */
const entryMembers = ["argv", "env", "exit"]

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

/** Whether a variable declaration list is `const` or `var`: not `let`, `using` or `await using`. */
const isConstOrVar = (list: ts.VariableDeclarationList) => (list.flags & (ts.NodeFlags.Let | ts.NodeFlags.Using)) === 0

/**
 * Whether an identifier is the name of an ambient `declare const` or
 * `declare var` declaration (owner ruling, 2026-11-20), such as
 * `declare const process: Process` in src/facade/process.d.ts. Only the
 * declared name: every use of it still counts, and so does the name of a
 * `declare let`, of a declaration without `declare`, and of one that is
 * ambient only because it sits in a `declare global` block.
 */
const isAmbientDeclarationName = (node: ts.Identifier) => {
  const declaration = node.parent
  if (!ts.isVariableDeclaration(declaration) || declaration.name !== node) return false
  const list = declaration.parent
  const statement = list.parent
  return (
    ts.isVariableDeclarationList(list) &&
    isConstOrVar(list) &&
    ts.isVariableStatement(statement) &&
    (statement.modifiers ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword)
  )
}

/** Whether an identifier is a reference to a global, not a property name or declaration. */
const isGlobalReference = (node: ts.Identifier) => {
  const parent = node.parent
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false
  if (ts.isImportSpecifier(parent) || ts.isPropertySignature(parent)) return false
  if (isAmbientDeclarationName(node)) return false
  return processGlobals.includes(node.text)
}

/**
 * Whether a global reference is `process.argv`, `process.env` or
 * `process.exit`: `process` as the object of a dotted property access
 * naming one of {@link entryMembers}. `process["argv"]`, `process` passed
 * on whole and any other member are not.
 */
const isEntryMember = (node: ts.Identifier) => {
  const parent = node.parent
  return (
    node.text === "process" &&
    ts.isPropertyAccessExpression(parent) &&
    entryMembers.includes(parent.name.text)
  )
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
 * referenced (except `process.argv`, `process.env` and `process.exit`
 * when `isEntry`), an `execFile` or `spawn` call without an explicit
 * `env`, or "git" as such a call's program (unless `mayRunGit`).
 */
export const processFindings = (
  text: string,
  mayStartProcesses: boolean,
  mayRunGit: boolean,
  isEntry = false,
): ReadonlyArray<string> => [
  ...parseFindings(text),
  ...nodesOf(text).flatMap((node) => [
    ...importedBy(node)
      .filter((name) => processModules.includes(name) && !mayStartProcesses)
      .map((name) => `imports ${name}`),
    ...(ts.isIdentifier(node) && isGlobalReference(node) && !(isEntry && isEntryMember(node))
      ? [`references ${node.text}`]
      : []),
    ...(ts.isCallExpression(node) && isProcessCallWithoutEnv(node)
      ? processCallName(node).map((name) => `${name} without env`)
      : []),
    ...(ts.isCallExpression(node) && !mayRunGit && runsGit(node) ? ["runs git outside git.ts"] : []),
  ]),
]

/** The number of calls named `name` in a module. */
export const callsNamed = (name: string, text: string) =>
  nodesOf(text).filter(
    (node) => ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name,
  ).length
