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

  // On failure, the message carries everything needed to tell a blocking
  // finding from a failed spawn: status, signal, spawn error, stderr and
  // the BLOCK lines (an intermittent failure on 2026-11-16 left none).
  it("passes on the repository's own Markdown", () => {
    const result = run()
    const blockLines = result.stdout
      .split("\n")
      .filter((line) => line.includes("BLOCK"))
    const diagnosis = JSON.stringify({
      status: result.status,
      signal: result.signal,
      error: result.error?.message,
      stderr: result.stderr,
      blockLines,
    })
    expect(result.error, diagnosis).toBeUndefined()
    expect(result.signal, diagnosis).toBeNull()
    expect(result.status, diagnosis).toBe(0)
    expect(result.stdout, diagnosis).toContain("prose: checked")
  })
})
