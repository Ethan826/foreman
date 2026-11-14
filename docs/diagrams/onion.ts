// Generates docs/diagrams/onion.svg, the architecture drawing in README.md.
// Run `bun run diagram` to rewrite the file; test/docs/onion.test.ts checks
// that the committed file equals this output and that the layer list matches
// the directories under src/.
//
// The import lists below restate the layer edges in eslint.rules.js
// (`mayImport`). Keep the two in step by hand; nothing compares them.

import { Array as Arr } from "effect"

interface Layer {
  readonly dir: string // directory under src/
  readonly name: string
  readonly note: string
  readonly planned: boolean
  readonly imports: ReadonlyArray<string>
}

// Rings from the center outward. A ring with two layers is split into
// a left and a right half.
export const rings: ReadonlyArray<ReadonlyArray<Layer>> = [
  [{ dir: "domain", name: "Domain", note: "types and policy", planned: false, imports: [] }],
  [
    { dir: "format", name: "Format", note: "decoders", planned: false, imports: ["Domain"] },
    { dir: "features", name: "Features", note: "decisions", planned: false, imports: ["Domain"] },
  ],
  [{ dir: "runtime", name: "Runtime", note: "Effect services", planned: true, imports: ["Domain"] }],
  [{ dir: "program", name: "Program", note: "wiring", planned: true, imports: ["Domain", "Features", "Format", "Runtime"] }],
  [{ dir: "facade", name: "Facade", note: "CLI", planned: true, imports: ["Domain", "Features", "Format", "Program"] }],
]

const caption: ReadonlyArray<string> = [
  "Every import points inward. The rules are",
  "narrower than a strict onion: Runtime imports",
  "only Domain, Format and Features do not",
  "import each other, and Facade does not",
  "import Runtime.",
]

const width = 960
const height = 640
const cx = 320
const cy = 320
// Outer radius of each ring, center first. The core ring is wider so its
// two half labels fit.
const radii: ReadonlyArray<number> = [64, 150, 200, 250, 300]
const outerRadius = 300
const legendX = 660

const outermost = Arr.length(rings) - 1
const radiusOf = (ring: number): number => radii[ring] ?? outerRadius
const innerRadiusOf = (ring: number): number => (ring === 0 ? 0 : radiusOf(ring - 1))

const style = `
    text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; fill: #1f2328; }
    .name { font-size: 15px; font-weight: 600; }
    .note, .small { font-size: 12px; fill: #59636e; }
    .ring { stroke: #59636e; stroke-width: 1.5; }
    .planned { stroke-dasharray: 6 5; }
    .divider { stroke: #59636e; stroke-width: 1.5; }
    .arrow { stroke: #1f2328; stroke-width: 2; fill: none; }
    .arrowhead { fill: #1f2328; }
    .f0 { fill: #ddf4ff; }
    .f1 { fill: #dafbe1; }
    .f2 { fill: #fff8c5; }
    .f3 { fill: #ffeff7; }
    .f4 { fill: #f6f8fa; }
    @media (prefers-color-scheme: dark) {
      text { fill: #f0f6fc; }
      .note, .small { fill: #9198a1; }
      .ring, .divider { stroke: #9198a1; }
      .arrow { stroke: #f0f6fc; }
      .arrowhead { fill: #f0f6fc; }
      .f0 { fill: #0d2a4a; }
      .f1 { fill: #12361f; }
      .f2 { fill: #3a3210; }
      .f3 { fill: #3b1d33; }
      .f4 { fill: #1e2530; }
    }`

const num = (n: number): string => n.toFixed(2).replace(/\.?0+$/, "")

const circle = (ring: number): string => {
  const planned = (rings[ring] ?? []).some((layer) => layer.planned)
  return `<circle class="ring f${num(ring)}${planned ? " planned" : ""}" cx="${num(cx)}" cy="${num(cy)}" r="${num(radiusOf(ring))}"/>`
}

const label = (x: number, y: number, layer: Layer): string =>
  `<text x="${num(x)}" y="${num(y)}" text-anchor="middle"><tspan class="name" x="${num(x)}">${layer.name}</tspan>` +
  `<tspan class="note" x="${num(x)}" dy="16">${layer.note}${layer.planned ? " (planned)" : ""}</tspan></text>`

const ringLabels = (ring: number): ReadonlyArray<string> => {
  const layers = rings[ring] ?? []
  const mid = (radiusOf(ring) + innerRadiusOf(ring)) / 2
  return Arr.length(layers) === 1
    ? layers.map((layer) => label(cx, ring === 0 ? cy - 8 : cy - mid - 6, layer))
    : layers.map((layer, i) => label(cx + (i === 0 ? -mid : mid), cy - 8, layer))
}

const divider = (ring: number): string =>
  `<line class="divider" x1="${num(cx)}" y1="${num(cy - radiusOf(ring))}" x2="${num(cx)}" y2="${num(cy - innerRadiusOf(ring))}"/>` +
  `<line class="divider" x1="${num(cx)}" y1="${num(cy + innerRadiusOf(ring))}" x2="${num(cx)}" y2="${num(cy + radiusOf(ring))}"/>`

const arrow = (): string => {
  const d = Math.SQRT1_2
  const from = outerRadius - 8
  const to = innerRadiusOf(1) + 6
  return (
    `<line class="arrow" x1="${num(cx + from * d)}" y1="${num(cy + from * d)}" ` +
    `x2="${num(cx + to * d)}" y2="${num(cy + to * d)}" marker-end="url(#head)"/>`
  )
}

// Outermost layer first.
const flat = rings.reduceRight<ReadonlyArray<Layer>>((acc, ring) => [...acc, ...ring], [])

const legend = (): ReadonlyArray<string> => {
  const entries = flat.flatMap((layer, i) => {
    const y = 40 + i * 52
    return [
      `<text class="name" x="${num(legendX)}" y="${num(y)}">${layer.name}</text>`,
      `<text class="small" x="${num(legendX)}" y="${num(y + 17)}">imports ${Arr.isReadonlyArrayEmpty(layer.imports) ? "nothing" : layer.imports.join(", ")}</text>`,
    ]
  })
  const captionY = 40 + Arr.length(flat) * 52 + 24
  const lines = caption.map(
    (line, i) => `<text class="small" x="${num(legendX)}" y="${num(captionY + i * 17)}">${line}</text>`,
  )
  return [...entries, ...lines]
}

export const renderOnion = (): string =>
  [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(width)} ${num(height)}" width="${num(width)}" height="${num(height)}" role="img" aria-labelledby="t">`,
    `<title id="t">Onion architecture: Domain at the center, then Features and Format, Runtime, Program and Facade; imports point inward</title>`,
    `<style>${style}\n  </style>`,
    `<defs><marker id="head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path class="arrowhead" d="M 0 0 L 10 5 L 0 10 z"/></marker></defs>`,
    ...rings.map((_, i) => outermost - i).map(circle),
    divider(1),
    ...rings.flatMap((_, i) => ringLabels(i)),
    arrow(),
    ...legend(),
    `</svg>`,
    ``,
  ].join("\n")
