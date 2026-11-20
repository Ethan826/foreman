// TSDoc gate (AGENTS.md, "Documentation"): every exported declaration in
// src/ carries a `/** ... */` comment directly above it. Decided on the
// TypeScript syntax tree, not on text.
//
// Blind spots. This checks presence only: it does not judge whether a
// comment is accurate, complete or more than a restatement of the name.
// It does not cover non-exported code; the rule asks for TSDoc on
// substantial private code too, and that part rests on review. It skips
// every `export { ... }` statement, so a re-export such as those in
// src/domain/events.ts and src/features/command-rules.ts needs no comment
// here; each re-exported name is checked in the module that declares it,
// as long as that module is in src/. The must-fail cases below show what
// the check detects.
import { describe, expect, it } from "@effect/vitest"
import ts from "typescript"

const sources = import.meta.glob<string>("../../src/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
})

const isExported = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node) ?? []).some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
  )

const hasTsDoc = (statement: ts.Statement, text: string): boolean =>
  (ts.getLeadingCommentRanges(text, statement.pos) ?? []).some(
    (range) =>
      range.kind === ts.SyntaxKind.MultiLineCommentTrivia &&
      text.startsWith("/**", range.pos),
  )

const nameOf = (statement: ts.Statement): string => {
  if (ts.isVariableStatement(statement))
    return statement.declarationList.declarations
      .map((d) => d.name.getText())
      .join(", ")
  if (
    (ts.isClassDeclaration(statement) ||
      ts.isFunctionDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement)) &&
    statement.name !== undefined
  )
    return statement.name.text
  return ts.SyntaxKind[statement.kind]
}

// Exported declarations without TSDoc, as "name" strings.
export const undocumented = (text: string): ReadonlyArray<string> => {
  const file = ts.createSourceFile("module.ts", text, ts.ScriptTarget.ES2022, true)
  return file.statements
    .filter((s) => isExported(s) && !ts.isExportDeclaration(s))
    .filter((s) => !hasTsDoc(s, text))
    .map(nameOf)
}

const exportedCount = (text: string): number =>
  ts
    .createSourceFile("module.ts", text, ts.ScriptTarget.ES2022, true)
    .statements.filter((s) => isExported(s) && !ts.isExportDeclaration(s)).length

describe("TSDoc on every export in src/", () => {
  it("checks a real number of exports (scan minimum)", () => {
    const total = Object.values(sources).reduce((n, t) => n + exportedCount(t), 0)
    expect(total).toBeGreaterThanOrEqual(60)
  })

  it.each(Object.entries(sources))("%s documents every export", (_path, text) => {
    expect(undocumented(text)).toEqual([])
  })
})

describe("TSDoc gate must-fail cases", () => {
  it.each([
    ["no comment", "export const a = 1", ["a"]],
    ["a line comment", "// a\nexport const a = 1", ["a"]],
    ["a plain block comment", "/* a */\nexport const a = 1", ["a"]],
    ["an undocumented class", "export class C {}", ["C"]],
    ["an undocumented interface", "export interface I { readonly x: number }", ["I"]],
  ])("flags %s", (_name, text, expected) => {
    expect(undocumented(text)).toEqual(expected)
  })

  it.each([
    "/** A. */\nexport const a = 1",
    "// header\n\n/** A. */\nexport type A = number",
    "const local = 1\nexport {}",
  ])("passes %j", (text) => {
    expect(undocumented(text)).toEqual([])
  })
})
