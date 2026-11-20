// Process gate (plan B11b; owner ruling on A1, 2026-11-19): only four
// modules in src/ can start a process, named by path: `src/runtime/git.ts`
// (git), `spawn.ts` (clients), `processes.ts` (`ps`) and
// `client-version.ts` (`<client> --version`). git.ts keeps its B11b
// policy and may import any of the process modules below; the other three
// may import `node:child_process` and no other (review B16). Every
// `execFile` and `spawn` call, in any module, gives an explicit
// environment, and only git.ts passes "git" as the program, so no
// production path runs git with the parent's environment or outside the
// clean runners. Decided on the TypeScript syntax tree, not on text.
//
// What counts as starting a process or reading the parent environment:
// importing, re-exporting, `import()`ing or `require()`ing
// `node:child_process`, `child_process`, `node:cluster` or `bun`; any
// reference to the `Bun` or `process` globals. A module with a syntax
// error fails outright, since its tree may not show all its code. The
// name of an ambient `declare const` or `declare var` declaration is not
// a reference (owner ruling, 2026-11-20); every use of it is.
//
// One exception (owner ruling on A1, 2026-11-19): `src/facade/main.ts`,
// the CLI's entry, may reference `process` as `process.argv`,
// `process.env` and `process.exit`, written as dotted property accesses,
// and in no other way. It may not reference `Bun` or import a process
// module. No other file has the exception. Its cases, and the ambient
// declaration's, are in process-entry-gate.test.ts; the scanner both
// files use is process-gate-scan.ts.
//
// Blind spots: a process started through another module this gate does
// not name (a native addon, a worker that imports child_process,
// `bun:ffi`), a specifier computed at run time, and an `execFile` or
// `spawn` reached through an alias such as `const run = execFile` or a
// namespace import (`childProcess.spawn`). The git-program rule sees only
// a literal "git" as the first argument: a program held in a variable,
// a path such as "/usr/bin/git", or argv chosen at run time (as spawn.ts
// and client-version.ts take theirs) escapes it, so a client launch whose
// argv starts with git is not caught here. It also cannot see a
// module that imports `startGit` from git.ts and passes it an environment
// other than the clean one. On the paths that creation and the startup
// check take, `test/program/git-coverage.test.ts` catches that, because
// the bypassed command drops out of its recorded sequence; on any other
// path nothing does. The must-fail cases below show what this gate
// detects.
import { describe, expect, it } from "@effect/vitest"
import { callsNamed, findingsAt, gitModule, processFindings, sources } from "./process-gate-scan.ts"

const spawnModule = "../../src/runtime/spawn.ts"
const processesModule = "../../src/runtime/processes.ts"
const versionModule = "../../src/runtime/client-version.ts"

describe("only the four process modules start a process, always with an explicit environment", () => {
  it.each([
    [gitModule, 1, 0],
    [spawnModule, 0, 1],
    [processesModule, 1, 0],
    [versionModule, 1, 0],
  ])("scans %s with its process calls (scan minimum)", (path, execFiles, spawns) => {
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(40)
    expect(callsNamed("execFile", sources[path] ?? "")).toBe(execFiles)
    expect(callsNamed("spawn", sources[path] ?? "")).toBe(spawns)
  })

  it.each(Object.entries(sources))("%s", (path, text) => {
    expect(findingsAt(path, text)).toEqual([])
  })
})

describe("process gate must-fail cases", () => {
  it.each([
    ["an import", `import { execFile } from "node:child_process"`, ["imports node:child_process"]],
    ["an unprefixed import", `import { spawn } from "child_process"`, ["imports child_process"]],
    ["a type-only import", `import type { ChildProcess } from "node:child_process"`, ["imports node:child_process"]],
    ["a re-export", `export { spawn } from "bun"`, ["imports bun"]],
    ["a dynamic import", `const cp = await import("node:child_process")`, ["imports node:child_process"]],
    ["a require", `const cp = require("child_process")`, ["imports child_process"]],
    ["the Bun global", `Bun.spawn(["git"])`, ["references Bun"]],
    ["the parent environment", `const home = process.env.HOME`, ["references process"]],
  ])("flags %s outside git.ts", (_name, text, expected) => {
    expect(processFindings(text, [], false)).toEqual(expected)
  })

  it.each([
    ["an unclosed import list", `import { execFile from "node:child_process"`],
    ["an unterminated string", `const program = "git`],
    ["a stray brace", `export const run = () => { startGit() }}`],
  ])("flags a module that does not parse: %s", (_name, text) => {
    expect(findingsAt(gitModule, text).filter((finding) => finding.startsWith("does not parse:"))).not.toEqual([])
  })

  it.each([
    ["no options", `execFile("git", [], cb)`],
    ["options without env", `execFile("git", [], { cwd, encoding: "utf8" }, cb)`],
    ["options passed by name", `execFile("git", [], options, cb)`],
  ])("flags execFile with %s, even in git.ts", (_name, text) => {
    expect(findingsAt(gitModule, text)).toEqual(["execFile without env"])
  })

  it.each([
    ["no options", `spawn("claude", [])`],
    ["options without env", `spawn("claude", [], { cwd, detached: true })`],
    ["options passed by name", `spawn("claude", [], options)`],
  ])("flags spawn with %s, even in a module that may start processes", (_name, text) => {
    expect(findingsAt(spawnModule, text)).toEqual(["spawn without env"])
  })

  it.each([
    ["execFile", `execFile("git", [], { cwd, env, encoding: "utf8" }, cb)`],
    ["spawn", `spawn("git", [], { cwd, env, detached: true, stdio })`],
  ])("flags git as the program of %s outside git.ts", (_name, text) => {
    expect(findingsAt(spawnModule, text)).toEqual(["runs git outside git.ts"])
  })

  it.each([
    [
      spawnModule,
      `import { spawn } from "node:child_process"; const child = spawn(file, args, { cwd, env: launch.env, detached: true })`,
    ],
    [processesModule, `import { execFile } from "node:child_process"; execFile(ps, args, { cwd, env: listing }, cb)`],
    [versionModule, `import { execFile } from "node:child_process"; execFile(client, args, { cwd, env }, cb)`],
  ])("passes a process start like its own in %s", (path, text) => {
    expect(findingsAt(path, text)).toEqual([])
  })

  it.each(
    [spawnModule, processesModule, versionModule].flatMap((path) => [
      [path, `import { spawn } from "bun"`, ["imports bun"]],
      [path, `export { spawn } from "bun"`, ["imports bun"]],
      [path, `const cluster = await import("cluster")`, ["imports cluster"]],
      [path, `import cluster from "node:cluster"`, ["imports node:cluster"]],
      [path, `const cp = require("child_process")`, ["imports child_process"]],
    ]),
  )("flags in %s, which may import only node:child_process: %s", (path, text, expected) => {
    expect(findingsAt(path, text)).toEqual(expected)
  })

  it.each([
    `import { spawn } from "bun"`,
    `import cluster from "node:cluster"`,
    `const cp = require("child_process")`,
  ])("keeps git.ts's B11b policy, which passes %j", (text) => {
    expect(findingsAt(gitModule, text)).toEqual([])
  })

  it.each([
    `import { Effect } from "effect"`,
    `import { Database } from "bun:sqlite"`,
    `const env = { PATH: "/usr/bin:/bin" }; execFile("git", [], { cwd, env, encoding: "utf8" }, cb)`,
    `const value = record.process`,
  ])("passes %j in git.ts", (text) => {
    expect(findingsAt(gitModule, text)).toEqual([])
  })
})
