// The README's architecture drawing is generated from docs/diagrams/onion.ts.
// These tests fail if the committed SVG drifts from the generator, or if the
// generator's layers stop matching the directories under src/, or if its
// per-layer import lists differ from the lint layer table (eslint.rules.js).
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Order } from "effect"
import { mayImport } from "../../eslint.rules.js"
import committed from "../../docs/diagrams/onion.svg?raw"
import { renderOnion, rings } from "../../docs/diagrams/onion.ts"

const sorted = (xs: ReadonlyArray<string>): ReadonlyArray<string> => Arr.sort(Order.String)(xs)

describe("onion diagram", () => {
  it("committed SVG is byte-identical to the generator output", () => {
    expect(committed).toBe(renderOnion())
  })

  it("has one layer per directory under src/", () => {
    const dirs = Object.keys(import.meta.glob("../../src/*/*")).map(
      (path) => path.split("/")[3] ?? "",
    )
    const layers = rings.flat().map((layer) => layer.dir)
    expect(sorted(layers)).toEqual(sorted([...new Set(dirs)]))
  })

  it("lists the same imports per layer as the lint layer table", () => {
    const layers = rings.flat()
    const dirOf = (name: string): string =>
      layers.find((layer) => layer.name === name)?.dir ?? `no layer named ${name}`
    const drawn = Object.fromEntries(
      layers.map((layer) => [layer.dir, sorted(layer.imports.map(dirOf))]),
    )
    const linted = Object.fromEntries(
      Object.entries(mayImport).map(([dir, allowed]) => [dir, sorted(allowed)]),
    )
    expect(drawn).toEqual(linted)
  })

  it("labels every layer in the SVG", () => {
    rings.flat().forEach((layer) => {
      expect(committed).toContain(`>${layer.name}</`)
    })
  })

  it("is transparent and ships a dark-mode override", () => {
    expect(committed).toContain("@media (prefers-color-scheme: dark)")
    expect(committed).not.toContain("<rect")
  })
})
