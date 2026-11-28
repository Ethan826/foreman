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

/**
 * The time budget, in milliseconds, of every test here (dogfood-6e, owner
 * ruling of 2026-11-27). Each starts a Bun process for the entry and
 * claims nothing about speed; a Bun start, which loads and transpiles the
 * entry's modules, took seconds while other sessions kept the load
 * average between 75 and 200.
 *
 * What it bounds: one Bun start per test, which stops at argument parsing
 * and starts no git, no `ps` and no client. The longest test, "exits 2
 * with the usage line on stderr when given no arguments", took 309 ms
 * idle, measured by the coordinator on 2026-11-28 at a load average of
 * about 3; at most 1,384 ms under load averages of 39 to 145.
 */
const entryMillis = 30_000

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
  }, entryMillis)

  it("exits 2 with the usage line for --help, which is not a command", () => {
    const run = runEntry("--help")
    expect({ error: run.error, status: run.status, stdout: run.stdout }).toEqual({ error: undefined, status: 2, stdout: "" })
    expect(run.stderr).toContain("--config <path> must come first")
    expect(run.stderr).toContain("usage: tarlatan --config <path>")
  }, entryMillis)

  it("names ruling add and overrule in the usage it prints", () => {
    const run = runEntry("--config", "/nonexistent/tarlatan.json", "ruling", "add")
    expect({ error: run.error, status: run.status, stdout: run.stdout }).toEqual({ error: undefined, status: 2, stdout: "" })
    expect(run.stderr).toContain("--text is required")
    expect(run.stderr).toContain("ruling add --text <text> [--supersedes <rulingId>]")
    expect(run.stderr).toContain("overrule <findingId> --note <reason>")
  }, entryMillis)

  it("names rounds grant and the unconverged close in the usage it prints", () => {
    const run = runEntry("--config", "/nonexistent/tarlatan.json", "rounds", "grant", "0", "--note", "x")
    expect({ error: run.error, status: run.status, stdout: run.stdout }).toEqual({ error: undefined, status: 2, stdout: "" })
    expect(run.stderr).toContain("rounds grant needs a whole number of at least 1, not 0")
    expect(run.stderr).toContain("rounds grant <n> --note <reason>")
    expect(run.stderr).toContain("session close --abandoned|--interrupted|--unconverged [--note <text>]")
  }, entryMillis)

  it("passes the owner's words, after the runtime and script path, to main", () => {
    const run = runEntry("--config", "/nonexistent/tarlatan.json", "bogus")
    expect({ error: run.error, status: run.status, stdout: run.stdout }).toEqual({ error: undefined, status: 2, stdout: "" })
    expect(run.stderr).toContain("unknown command: bogus")
    expect(run.stderr).toContain("usage: tarlatan --config <path>")
  }, entryMillis)
})
