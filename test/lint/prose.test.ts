// Gate integrity for the prose gate (skill gate-integrity): the script has to
// reject a Markdown file with a known tell, accept a clean one, and refuse an
// empty file list.
import { describe, expect, it } from "@effect/vitest"
import { spawnSync } from "node:child_process"

const run = (...files: ReadonlyArray<string>) =>
  spawnSync("sh", ["tools/prose/check.sh", ...files], { encoding: "utf8" })

describe("prose gate", () => {
  it("rejects a file with a known tell", () => {
    const result = run("lint-fixtures/prose/must-fail.md")
    expect(result.status).toBe(1)
    expect(result.stdout).toContain("BLOCK")
  })

  it("accepts a clean file", () => {
    const result = run("lint-fixtures/prose/clean.md")
    expect(result.status).toBe(0)
  })

  it("passes on the repository's own Markdown", () => {
    const result = run()
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("prose: checked")
  })
})
