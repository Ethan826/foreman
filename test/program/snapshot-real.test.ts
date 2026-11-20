// The snapshot against real disposable repositories (plan A2, "Snapshot
// identity and raw checks"). A supervisor worktree is added from the
// owner's repository and its identity recorded, as at creation; the
// snapshot then stages it in a temporary index in a state directory and
// checks every entry of the staged tree against the bytes on disk.
import { describe, expect, it } from "@effect/vitest"
import { Effect, Match, Schema } from "effect"
import { chmodSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { Revision } from "../../src/domain/ids.ts"
import {
  ContentMismatch,
  NestedRepository,
  SnapshotObjectFormatRefused,
  SnapshotPreflightRefused,
  SnapshotRefused,
  type SnapshotMismatch,
} from "../../src/domain/snapshot.ts"
import type { GitInvocation } from "../../src/runtime/git.ts"
import { git, withRepo } from "../runtime/git-repo.ts"
import { commandOf, inSupervisor, recordingStart, snapshot, snapshotWith, type Setting } from "./snapshot-setting.ts"

/** The snapshot's failure; the test fails if it succeeds. */
const refusal = (setting: Setting) => Effect.flip(snapshot(setting))

/** The staged tree's listing, `<mode> <type> <object>\t<path>` per line. */
const listing = (setting: Setting, tree: Revision) => git(setting.identity.path, "ls-tree", "-r", tree)

/** A mismatch's kind and path, for comparing lists of mismatches. */
const described = (mismatch: SnapshotMismatch) => [
  Match.valueTags(mismatch, {
    ModeRefused: () => "mode",
    EntryNotObserved: () => "not observed",
    KindMismatch: () => "kind",
    ExecutableMismatch: () => "executable",
    ContentMismatch: () => "content",
  }),
  mismatch.entry.path,
]

/** The mismatches of a refusal; none when the failure is not {@link SnapshotRefused}. */
const mismatchesOf = (refused: unknown) => (Schema.is(SnapshotRefused)(refused) ? refused.mismatches : [])

/** Makes the unreadable link targets removable again. */
const restoreModes = (dir: string) =>
  Effect.sync(() => {
    chmodSync(`${dir}/sealed`, 0o755)
    chmodSync(`${dir}/outside/locked`, 0o644)
  })

/**
 * A SHA-256 repository at `<dir>/wide` with one commit, snapshotted as its
 * own worktree, is refused before staging with what rev-parse printed.
 */
const wideRefused = (dir: string) =>
  Effect.gen(function* () {
    yield* git(dir, "init", "--quiet", "--object-format=sha256", "-b", "main", "wide")
    const top = `${dir}/wide`
    yield* git(top, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "--quiet", "--allow-empty", "-m", "w")
    mkdirSync(`${dir}/state`)
    const identity = { path: top, gitDir: `${top}/.git`, commonDir: `${top}/.git` }
    const base = Revision.make(yield* git(top, "rev-parse", "HEAD"))
    const refused = yield* Effect.flip(snapshot({ identity, base, state: `${dir}/state` }))
    expect(refused).toEqual(new SnapshotObjectFormatRefused({ exitCode: 0, stdout: "sha256\n" }))
  })

const indexFileOf = (call: GitInvocation) => call.env.GIT_INDEX_FILE

describe("the snapshot of an unchanged worktree", () => {
  it.effect("is the base revision's tree", inSupervisor((setting) =>
    Effect.gen(function* () {
      const tree = yield* snapshot(setting)
      expect(tree).toBe(yield* git(setting.identity.path, "rev-parse", `${setting.base}^{tree}`))
    })))
})

describe("the snapshot covers tracked and untracked files", () => {
  it.effect("stages a modified file and an untracked one with git's blob ids", inSupervisor((setting) =>
    Effect.gen(function* () {
      const top = setting.identity.path
      writeFileSync(`${top}/a.txt`, "changed\n")
      writeFileSync(`${top}/new.txt`, "new\n")
      const tree = yield* snapshot(setting)
      const changed = yield* git(top, "hash-object", "--no-filters", "a.txt")
      const added = yield* git(top, "hash-object", "--no-filters", "new.txt")
      const lines = (yield* listing(setting, tree)).split("\n")
      expect(lines).toContain(`100644 blob ${changed}\ta.txt`)
      expect(lines).toContain(`100644 blob ${added}\tnew.txt`)
    })))
})

describe("raw checks against real repositories", () => {
  it.effect("refuses a CRLF file that core.autocrlf=true converts while staging", inSupervisor((setting) =>
    Effect.gen(function* () {
      const top = setting.identity.path
      yield* git(top, "config", "core.autocrlf", "true")
      writeFileSync(`${top}/crlf.txt`, "one\r\ntwo\r\n")
      const refused = yield* refusal(setting)
      const mismatches = mismatchesOf(refused)
      const raw = yield* git(top, "hash-object", "--no-filters", "crlf.txt")
      expect(mismatches.map(described)).toEqual([["content", "crlf.txt"]])
      expect(Schema.is(ContentMismatch)(mismatches[0]) && mismatches[0].blob).toBe(raw)
    })))

  it.effect("detects an executable-bit change: the staged tree records mode 100755", inSupervisor((setting) =>
    Effect.gen(function* () {
      chmodSync(`${setting.identity.path}/a.txt`, 0o755)
      const tree = yield* snapshot(setting)
      expect(tree).not.toBe(yield* git(setting.identity.path, "rev-parse", `${setting.base}^{tree}`))
      expect((yield* listing(setting, tree)).split("\n")).toContain(
        `100755 blob ${yield* git(setting.identity.path, "rev-parse", `${setting.base}:a.txt`)}\ta.txt`,
      )
    })))

  it.effect("refuses an executable-bit change that core.fileMode=false keeps out of the tree", inSupervisor((setting) =>
    Effect.gen(function* () {
      yield* git(setting.identity.path, "config", "core.fileMode", "false")
      chmodSync(`${setting.identity.path}/a.txt`, 0o755)
      chmodSync(`${setting.identity.path}/run.sh`, 0o644)
      const refused = yield* refusal(setting)
      expect(mismatchesOf(refused).map(described)).toEqual([
        ["executable", "a.txt"],
        ["executable", "run.sh"],
      ])
    })))

  it.effect("matches internal, dangling and outside links without reading a target", inSupervisor((setting, dir) =>
    Effect.gen(function* () {
      const top = setting.identity.path
      mkdirSync(`${dir}/outside`)
      writeFileSync(`${dir}/outside/locked`, "secret\n")
      chmodSync(`${dir}/outside/locked`, 0o000)
      mkdirSync(`${dir}/sealed`)
      const links = { internal: "run.sh", dangling: "missing/nowhere", outside: `${dir}/outside/locked`, sealed: `${dir}/sealed/inner` }
      for (const [name, target] of Object.entries(links)) symlinkSync(target, `${top}/${name}`)
      chmodSync(`${dir}/sealed`, 0o000)
      const tree = yield* Effect.ensuring(snapshot(setting), restoreModes(dir))
      const lines = (yield* listing(setting, tree)).split("\n")
      for (const [name, target] of Object.entries(links)) {
        writeFileSync(`${dir}/link-text`, target)
        const id = yield* git(top, "hash-object", "--no-filters", `${dir}/link-text`)
        expect(lines).toContain(`120000 blob ${id}\t${name}`)
      }
    })))

  it.effect("refuses a nested repository with a commit before staging, not as a staged gitlink", inSupervisor((setting) =>
    Effect.gen(function* () {
      const top = setting.identity.path
      yield* git(top, "init", "--quiet", "-b", "main", "sub")
      yield* git(`${top}/sub`, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "--quiet", "--allow-empty", "-m", "sub")
      const refused = yield* refusal(setting)
      expect(refused).toEqual(new SnapshotPreflightRefused({ findings: [new NestedRepository({ path: "sub" })] }))
    })))

  it.effect("refuses a repository whose object format is not SHA-1", () => withRepo(wideRefused))
})

describe("the snapshot leaves the repository as it was", () => {
  it.effect("keeps the worktree's index byte-identical and every ref and HEAD unmoved", inSupervisor((setting) =>
    Effect.gen(function* () {
      const top = setting.identity.path
      writeFileSync(`${top}/a.txt`, "changed\n")
      writeFileSync(`${top}/new.txt`, "new\n")
      const indexBefore = readFileSync(`${setting.identity.gitDir}/index`)
      const refsBefore = yield* git(setting.identity.commonDir, "for-each-ref")
      const headBefore = yield* git(top, "rev-parse", "HEAD")
      yield* snapshot(setting)
      expect(readFileSync(`${setting.identity.gitDir}/index`)).toEqual(indexBefore)
      expect(yield* git(setting.identity.commonDir, "for-each-ref")).toBe(refsBefore)
      expect(yield* git(top, "rev-parse", "HEAD")).toBe(headBefore)
      expect(yield* git(top, "status", "--porcelain")).toBe("M a.txt\n?? new.txt")
    })))

  it.effect("stages in a fresh index file inside the state directory and removes it afterwards", inSupervisor((setting) =>
    Effect.gen(function* () {
      const calls: Array<GitInvocation> = []
      yield* snapshotWith(recordingStart(calls))(setting)
      const indexFiles = [...new Set(calls.map(indexFileOf))]
      expect(indexFiles).toHaveLength(1)
      const indexFile = indexFiles[0] ?? ""
      expect(indexFile.startsWith(`${setting.state}/`)).toBe(true)
      expect(existsSync(indexFile)).toBe(false)
      expect(existsSync(indexFile.slice(0, indexFile.lastIndexOf("/")))).toBe(false)
      expect(calls.map(commandOf)).toEqual([
        ["rev-parse", "--show-object-format"],
        ["ls-tree", "--full-tree"],
        ["ls-files", "-z"],
        ["read-tree", setting.base],
        ["add", "-A"],
        ["write-tree"],
        ["ls-tree", "--full-tree"],
      ])
    })))
})
