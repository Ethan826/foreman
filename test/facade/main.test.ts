// The CLI's entry (owner ruling on A1, 2026-11-19): `bun
// src/facade/main.ts` run as a real subprocess. Each case stops at
// argument parsing, before any configuration is read or Program is
// wired, so no client and no git command runs; the unknown command also
// names a configuration file that does not exist, so a parse that let
// it through would fail on the missing file rather than start anything.
// The exit statuses are cli.ts's: 2 on a usage error.
import { describe, expect, it } from "@effect/vitest"
import { spawnSync } from "node:child_process"

/** The entry script, from this test file's directory. */
const entry = `${import.meta.dirname}/../../src/facade/main.ts`

/** Runs the entry with `args` under the Bun running this test, and returns its exit status and output. */
const runEntry = (...args: ReadonlyArray<string>) => {
  const result = spawnSync(process.execPath, [entry, ...args], { encoding: "utf8" })
  return { error: result.error, status: result.status, stdout: result.stdout, stderr: result.stderr }
}

describe("bun src/facade/main.ts", () => {
  it("exits 2 with the usage line on stderr when given no arguments", () => {
    const run = runEntry()
    expect({ error: run.error, status: run.status, stdout: run.stdout }).toEqual({ error: undefined, status: 2, stdout: "" })
    expect(run.stderr).toContain("--config <path> must come first")
    expect(run.stderr).toContain("usage: tarlatan --config <path>")
  })

  it("exits 2 with the usage line for --help, which is not a command", () => {
    const run = runEntry("--help")
    expect({ error: run.error, status: run.status, stdout: run.stdout }).toEqual({ error: undefined, status: 2, stdout: "" })
    expect(run.stderr).toContain("--config <path> must come first")
    expect(run.stderr).toContain("usage: tarlatan --config <path>")
  })

  it("names ruling add and overrule in the usage it prints", () => {
    const run = runEntry("--config", "/nonexistent/tarlatan.json", "ruling", "add")
    expect({ error: run.error, status: run.status, stdout: run.stdout }).toEqual({ error: undefined, status: 2, stdout: "" })
    expect(run.stderr).toContain("--text is required")
    expect(run.stderr).toContain("ruling add --text <text> [--supersedes <rulingId>]")
    expect(run.stderr).toContain("overrule <findingId> --note <reason>")
  })

  it("passes the owner's words, after the runtime and script path, to main", () => {
    const run = runEntry("--config", "/nonexistent/tarlatan.json", "bogus")
    expect({ error: run.error, status: run.status, stdout: run.stdout }).toEqual({ error: undefined, status: 2, stdout: "" })
    expect(run.stderr).toContain("unknown command: bogus")
    expect(run.stderr).toContain("usage: tarlatan --config <path>")
  })
})
