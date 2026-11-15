// Drift guard for the layer READMEs (src/<layer>/README.md).
//
// Two checks:
// 1. Every class name in a README's Mermaid classDiagram blocks (declared with
//    `class Name`, or used as an end of a relation) is exported from a module
//    in that README's own directory. Exports are read from the TypeScript
//    syntax tree, so types, classes, constants and `export { ... }` lists all
//    count.
// 2. Each README's "May import:" line equals the lint layer table
//    (`mayImport` in eslint.rules.js), so a README cannot name an import the
//    lint rules forbid, and cannot omit one they allow.
//
// Blind spots. This checks names only. It does not check that a relation
// (inheritance, composition) exists in the code, that a field or its type
// matches, that a member listed inside a class box exists, or that flowchart
// and sequence diagrams match the code. A README can also describe an import
// in prose that contradicts its "May import:" line; only the line is
// checked. A name that is exported but unrelated to what the diagram claims
// passes. The must-fail cases below show that the two checks do detect
// what they cover.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Order } from "effect"
import ts from "typescript"
import { layers, mayImport } from "../../eslint.rules.js"

const sources = import.meta.glob<string>("../../src/*/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
})
const readmes = import.meta.glob<string>("../../src/*/README.md", {
  query: "?raw",
  import: "default",
  eager: true,
})

const sorted = (xs: ReadonlyArray<string>): ReadonlyArray<string> =>
  Arr.sort(Order.String)(xs)

const layerOf = (path: string): string => path.split("/")[3] ?? ""

const isExported = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node) ?? []).some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
  )

const exportedNames = (text: string): ReadonlyArray<string> =>
  ts
    .createSourceFile("module.ts", text, ts.ScriptTarget.ES2022)
    .statements.flatMap((statement): ReadonlyArray<string> => {
      if (ts.isExportDeclaration(statement))
        return statement.exportClause !== undefined &&
          ts.isNamedExports(statement.exportClause)
          ? statement.exportClause.elements.map((element) => element.name.text)
          : []
      if (!isExported(statement)) return []
      if (ts.isVariableStatement(statement))
        return statement.declarationList.declarations.flatMap((declaration) =>
          ts.isIdentifier(declaration.name) ? [declaration.name.text] : [],
        )
      if (
        (ts.isClassDeclaration(statement) ||
          ts.isFunctionDeclaration(statement) ||
          ts.isTypeAliasDeclaration(statement) ||
          ts.isInterfaceDeclaration(statement)) &&
        statement.name !== undefined
      )
        return [statement.name.text]
      return []
    })

const exportsByLayer = (layer: string): ReadonlyArray<string> =>
  Object.entries(sources)
    .filter(([path]) => layerOf(path) === layer)
    .flatMap(([, text]) => exportedNames(text))

const classDiagrams = (markdown: string): ReadonlyArray<string> =>
  [...markdown.matchAll(/```mermaid\n([\s\S]*?)```/g)]
    .map((match) => match[1] ?? "")
    .filter((block) => block.trimStart().startsWith("classDiagram"))

const arrow = String.raw`(?:<\|--|\*--|o--|-->|<--|\.\.>|<\.\.|\.\.\|>|--|\.\.)`
const declared = /^\s*class\s+([A-Za-z_]\w*)/gm
const related = new RegExp(
  String.raw`^\s*([A-Za-z_]\w*)\s+(?:"[^"]*"\s+)?${arrow}\s+(?:"[^"]*"\s+)?([A-Za-z_]\w*)`,
  "gm",
)

const diagramNames = (markdown: string): ReadonlyArray<string> => [
  ...new Set(
    classDiagrams(markdown).flatMap((block) => [
      ...[...block.matchAll(declared)].map((match) => match[1] ?? ""),
      ...[...block.matchAll(related)].flatMap((match) => [
        match[1] ?? "",
        match[2] ?? "",
      ]),
    ]),
  ),
]

const missingFrom = (
  markdown: string,
  exported: ReadonlyArray<string>,
): ReadonlyArray<string> =>
  diagramNames(markdown).filter((name) => !exported.includes(name))

const declaredImports = (markdown: string): ReadonlyArray<string> | undefined => {
  const line = /^May import:\s*(.+?)\.\s*$/m.exec(markdown)?.[1]
  return line === undefined
    ? undefined
    : sorted([...line.matchAll(/`([a-z]+)`/g)].map((match) => match[1] ?? ""))
}

const readmeFor = (layer: string): string =>
  Object.entries(readmes).find(([path]) => layerOf(path) === layer)?.[1] ?? ""

describe("layer READMEs", () => {
  it("exist for every layer in the lint table", () => {
    expect(sorted(Object.keys(readmes).map(layerOf))).toEqual(sorted(layers))
  })

  it.each(["domain", "format", "features"])(
    "%s: every class in a class diagram is exported from the layer",
    (layer) => {
      const names = diagramNames(readmeFor(layer))
      expect(names.length).toBeGreaterThanOrEqual(4)
      expect(missingFrom(readmeFor(layer), exportsByLayer(layer))).toEqual([])
    },
  )

  it.each(layers)('%s: "May import:" equals the lint layer table', (layer) => {
    expect(declaredImports(readmeFor(layer))).toEqual(
      sorted(mayImport[layer] ?? ["layer missing from the lint table"]),
    )
  })

  it("scans real exports (guards against an empty scan)", () => {
    expect(exportsByLayer("domain")).toContain("TrancheId")
    expect(exportsByLayer("features")).toContain("PaceDecision")
    expect(exportsByLayer("format")).toContain("ClaudeEvent")
  })
})

describe("the drift checks detect what they cover", () => {
  const diagram = [
    "```mermaid",
    "classDiagram",
    "    class Alpha",
    "    Alpha <|-- Beta",
    "    Beta ..> Gamma : uses",
    "```",
  ].join("\n")

  it("flags declared and related names that are not exported", () => {
    expect(missingFrom(diagram, ["Alpha", "Gamma"])).toEqual(["Beta"])
    expect(missingFrom(diagram, ["Alpha", "Beta"])).toEqual(["Gamma"])
    expect(missingFrom(diagram, ["Beta", "Gamma"])).toEqual(["Alpha"])
  })

  it("reads type-only, class, const and list exports", () => {
    expect(
      exportedNames(
        "export type T = 1\nexport class C {}\nexport const k = 1\nconst z = 1\nexport { z }",
      ),
    ).toEqual(["T", "C", "k", "z"])
  })

  it("flags a forbidden import and a missing one", () => {
    expect(declaredImports("May import: `domain`, `runtime`.")).not.toEqual(
      sorted(mayImport.features ?? []),
    )
    expect(declaredImports("May import: nothing.")).not.toEqual(
      sorted(mayImport.features ?? []),
    )
  })
})
