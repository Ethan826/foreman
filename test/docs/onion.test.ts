// The README's architecture drawing is generated from docs/diagrams/onion.ts.
// These tests fail if the committed SVG drifts from the generator, or if the
// generator's layers stop matching the directories under src/.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Order } from "effect"
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
