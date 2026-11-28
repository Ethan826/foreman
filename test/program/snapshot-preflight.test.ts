// The snapshot's preflight against real disposable repositories (review
// finding B08, M14). Before anything is staged, a gitlink in the base
// tree, a nested repository and a FIFO, socket or other special file in
// the covered worktree are refused, and `read-tree`, `add` and
// `write-tree` never run. Ignored paths are not covered and so are not
// refused, unless the base revision tracks them.
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { spawnSync } from "node:child_process"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { Revision } from "../../src/domain/ids.ts"
import {
  GitlinkInBase,
  NestedRepository,
  SnapshotPreflightRefused,
  SpecialFile,
  type PreflightFinding,
} from "../../src/domain/snapshot.ts"
import type { GitInvocation } from "../../src/runtime/git.ts"
import { git, repositoryMillis } from "../runtime/git-repo.ts"
import { commandOf, inSupervisor, recordingStart, snapshotWith, type Setting } from "./snapshot-setting.ts"

/** The commands that stage, none of which may run when the preflight refuses. */
const stagingCommands = ["read-tree", "add", "write-tree"]

/** Makes a FIFO at `path`. */
const makeFifo = (path: string) => {
  const made = spawnSync("/usr/bin/mkfifo", [path], { encoding: "utf8" })
  expect(made.status).toBe(0)
}

/** Runs `use` while a Unix socket listens at `path`, closing it afterwards. */
const withSocket = <A, E>(path: string, use: Effect.Effect<A, E>) =>
  Effect.acquireUseRelease(
    Effect.callback<ReturnType<typeof createServer>>((resume) => {
      const server = createServer()
      server.listen(path, () => {
        resume(Effect.succeed(server))
      })
    }),
    () => use,
    (server) =>
      Effect.callback<boolean>((resume) => {
        server.close(() => {
          resume(Effect.succeed(true))
        })
      }),
  )

/**
 * Takes the snapshot through a recording process call, requires the
 * preflight refusal with exactly `findings`, and requires that no staging
 * command ran.
 */
const refusedBeforeStaging = (setting: Setting, findings: ReadonlyArray<PreflightFinding>) =>
  Effect.gen(function* () {
    const calls: Array<GitInvocation> = []
    const refused = yield* Effect.flip(snapshotWith(recordingStart(calls))(setting))
    expect(refused).toEqual(new SnapshotPreflightRefused({ findings }))
    const staged = calls.map(commandOf).filter((command) => stagingCommands.includes(command[0] ?? ""))
    expect(staged).toEqual([])
  })

/** Takes the snapshot through a recording process call and requires it to stage and succeed. */
const stagedAndTaken = (setting: Setting) =>
  Effect.gen(function* () {
    const calls: Array<GitInvocation> = []
    yield* snapshotWith(recordingStart(calls))(setting)
    expect(calls.map(commandOf).map((command) => command[0])).toContain("write-tree")
  })

/** Commits a gitlink at `sub` on the worktree's branch and returns the setting with that commit as its base. */
const withBaseGitlink = (setting: Setting) =>
  Effect.gen(function* () {
    const top = setting.identity.path
    const commit = yield* git(top, "rev-parse", "HEAD")
    yield* git(top, "update-index", "--add", "--cacheinfo", `160000,${commit},sub`)
    yield* git(top, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "--quiet", "-m", "gitlink")
    return { ...setting, base: Revision.make(yield* git(top, "rev-parse", "HEAD")) }
  })

describe("the preflight refuses before staging", () => {
  it.effect("a gitlink in the base tree", inSupervisor((setting) =>
    Effect.flatMap(withBaseGitlink(setting), (based) =>
      refusedBeforeStaging(based, [new GitlinkInBase({ path: "sub" })]))), repositoryMillis)

  it.effect("a nested repository", inSupervisor((setting) =>
    Effect.gen(function* () {
      yield* git(setting.identity.path, "init", "--quiet", "-b", "main", "sub")
      yield* refusedBeforeStaging(setting, [new NestedRepository({ path: "sub" })])
    })), repositoryMillis)

  it.effect("a directory holding a .git that is not a valid repository", inSupervisor((setting) =>
    Effect.gen(function* () {
      mkdirSync(`${setting.identity.path}/odd`)
      mkdirSync(`${setting.identity.path}/odd/.git`)
      writeFileSync(`${setting.identity.path}/odd/file.txt`, "inside\n")
      yield* refusedBeforeStaging(setting, [new NestedRepository({ path: "odd" })])
    })), repositoryMillis)

  it.effect("a FIFO", inSupervisor((setting) =>
    Effect.gen(function* () {
      makeFifo(`${setting.identity.path}/pipe`)
      yield* refusedBeforeStaging(setting, [new SpecialFile({ path: "pipe" })])
    })), repositoryMillis)

  it.effect("a FIFO alone in a directory git lists nothing from", inSupervisor((setting) =>
    Effect.gen(function* () {
      mkdirSync(`${setting.identity.path}/run`)
      makeFifo(`${setting.identity.path}/run/pipe`)
      yield* refusedBeforeStaging(setting, [new SpecialFile({ path: "run/pipe" })])
    })), repositoryMillis)

  it.effect("a socket", inSupervisor((setting) =>
    withSocket(`${setting.identity.path}/sock`, refusedBeforeStaging(setting, [new SpecialFile({ path: "sock" })]))),
  repositoryMillis)

  it.effect("a FIFO at a path the base tracks, though an ignore pattern matches it", inSupervisor((setting) =>
    Effect.gen(function* () {
      writeFileSync(`${setting.identity.path}/.gitignore`, "a.txt\n")
      rmSync(`${setting.identity.path}/a.txt`, { recursive: false, force: false })
      makeFifo(`${setting.identity.path}/a.txt`)
      yield* refusedBeforeStaging(setting, [new SpecialFile({ path: "a.txt" })])
    })), repositoryMillis)
})

describe("the preflight leaves ignored paths alone", () => {
  it.effect("an ignored FIFO beside covered files", inSupervisor((setting) =>
    Effect.gen(function* () {
      writeFileSync(`${setting.identity.path}/.gitignore`, "*.pipe\n")
      makeFifo(`${setting.identity.path}/app.pipe`)
      yield* stagedAndTaken(setting)
    })), repositoryMillis)

  it.effect("a nested repository and a FIFO inside an ignored directory", inSupervisor((setting) =>
    Effect.gen(function* () {
      const top = setting.identity.path
      writeFileSync(`${top}/.gitignore`, "vendor/\n")
      mkdirSync(`${top}/vendor`)
      yield* git(`${top}/vendor`, "init", "--quiet", "-b", "main", "lib")
      makeFifo(`${top}/vendor/pipe`)
      yield* stagedAndTaken(setting)
    })), repositoryMillis)
})
