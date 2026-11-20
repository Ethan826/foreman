// The process gate's two narrowings of "any reference to `process`"
// (git-process-gate.test.ts states the gate). First, the CLI's entry
// (owner ruling on A1, 2026-11-19): src/facade/main.ts may read
// `process.argv` and `process.env` and call `process.exit`, as dotted
// property accesses, and nothing else; the same text anywhere else is
// flagged. Second, the name of an ambient `declare const` or
// `declare var` declaration is not a reference (owner ruling,
// 2026-11-20), so src/facade/process.d.ts may declare the global; every
// use of the name, in that file or any other, still counts.
import { describe, expect, it } from "@effect/vitest"
import { entryModule, findingsAt, processFindings, sources } from "./process-gate-scan.ts"

describe("the entry module's process members (owner ruling on A1)", () => {
  const entry = `const code = await run(main(process.argv.slice(2), process.env)); process.exit(code)`

  it("scans the entry module, which reads process.argv and process.env and calls process.exit", () => {
    const text = sources[entryModule] ?? ""
    expect(text).toContain("process.argv")
    expect(text).toContain("process.env")
    expect(text).toContain("process.exit")
  })

  it("passes process.argv, process.env and process.exit in the entry module", () => {
    expect(findingsAt(entryModule, entry)).toEqual([])
  })

  it("flags the same three members in any other module", () => {
    expect(processFindings(entry, [], false, false)).toEqual([
      "references process",
      "references process",
      "references process",
    ])
  })

  it.each([
    ["another member", `process.cwd()`],
    ["a member read by index", `process["argv"]`],
    ["process passed on whole", `run(process)`],
    ["process aliased", `const proc = process; proc.exit(1)`],
    ["a destructured member", `const { argv } = process`],
  ])("flags %s in the entry module", (_name, text) => {
    expect(findingsAt(entryModule, text)).toEqual(["references process"])
  })

  it("flags the Bun global in the entry module", () => {
    expect(findingsAt(entryModule, `Bun.exit(1)`)).toEqual(["references Bun"])
  })

  it("flags a process import in the entry module", () => {
    expect(findingsAt(entryModule, `import { spawn } from "node:child_process"`)).toEqual([
      "imports node:child_process",
    ])
  })
})

describe("an ambient declaration of process (owner ruling, 2026-11-20)", () => {
  const declared = `declare const process: Process;`

  it.each([
    ["declare const", `declare const process: Process`],
    ["declare var", `declare var process: Process`],
  ])("passes the name of a %s declaration alone", (_name, text) => {
    expect(processFindings(text, [], false)).toEqual([])
  })

  it.each([
    ["process aliased", `${declared} const proc = process`],
    ["another member", `${declared} process.cwd()`],
  ])("flags %s in a module that also declares process", (_name, text) => {
    expect(processFindings(text, [], false)).toEqual(["references process"])
  })

  it.each([
    ["a declaration without declare", `const process = { argv: [] }`],
    ["a declare let", `declare let process: Process`],
    ["a declaration ambient only inside declare global", `declare global { const process: Process }`],
  ])("flags the name of %s", (_name, text) => {
    expect(processFindings(text, [], false)).toEqual(["references process"])
  })
})
