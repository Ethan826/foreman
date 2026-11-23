// A moved HEAD through the production composition (owner ruling of
// 2026-11-23, dogfood-3a). After a clean review, a commit in the
// supervisor worktree moves HEAD off the session's base without changing
// its tree. `status` reports the moved HEAD and writes nothing,
// `session close --finished` is refused for it by its own HEAD read, and
// `session close --abandoned` still closes the session. A refused
// attribute source does not hide a moved HEAD: a launch is refused for
// both, and `status` shows both (owner finding F2, dogfood-3a round 1).
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Effect, Schema } from "effect"
import { existsSync, mkdirSync } from "node:fs"
import { emptyCommit, git } from "../runtime/git-repo.ts"
import { cli, endToEndMillis, failureTag, type Layout, openedSession, recorded, succeeded, withLayout } from "./production-harness.ts"
import { treeOf } from "./state-tree.ts"

/** Opens a session, implements, reviews clean, then commits in the worktree; returns the base and the new HEAD. */
const movedAfterCleanReview = (layout: Layout) =>
  Effect.gen(function* () {
    yield* openedSession(layout)
    yield* succeeded(layout, ["implement", "--waive"])
    yield* succeeded(layout, ["review", "--waive", "--attest"])
    const base = yield* git(layout.supervisor, "rev-parse", "HEAD")
    yield* emptyCommit(layout.supervisor, "moved by the agent")
    return { base, head: yield* git(layout.supervisor, "rev-parse", "HEAD") }
  })

const statusReportsMovedHead = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      const { base, head } = yield* movedAfterCleanReview(layout)
      const before = treeOf(layout.root)
      const run = yield* cli(layout, ["status"])
      expect([run.status, run.err]).toEqual([0, []])
      expect(treeOf(layout.root)).toEqual(before)
      const shown = Arr.join(run.out, "\n")
      expect(shown).toContain('"HeadMoved"')
      expect(shown).toContain(base)
      expect(shown).toContain(head)
    }),
  )

const finishRefusedAbandonAllowed = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      const { head } = yield* movedAfterCleanReview(layout)
      const finish = yield* cli(layout, ["session", "close", "--finished", "--attest"])
      expect([finish.status, failureTag(finish)]).toEqual([1, "CommandRefused"])
      expect(Arr.join(finish.err, "\n")).toContain('"HeadMoved"')
      expect(Arr.join(finish.err, "\n")).toContain(head)
      yield* succeeded(layout, ["session", "close", "--abandoned"])
    }),
  )

/** Owner read, write and search; group and others read and search. */
const directoryMode = 0o755

/** The refusal a failed run printed on stderr: its tag and its reasons. */
const PrintedRefusal = Schema.fromJsonString(Schema.Struct({ _tag: Schema.String, reasons: Schema.Array(Schema.Unknown) }))

/**
 * Opens a session, moves HEAD with an empty commit, then refuses an
 * attribute source that every revision shares (a directory at the common
 * directory's `info/attributes`); returns the base and the new HEAD.
 */
const refusedAndMoved = (layout: Layout) =>
  Effect.gen(function* () {
    yield* openedSession(layout)
    const base = yield* git(layout.supervisor, "rev-parse", "HEAD")
    yield* emptyCommit(layout.supervisor, "moved by the agent")
    const head = yield* git(layout.supervisor, "rev-parse", "HEAD")
    const commonDir = yield* git(layout.supervisor, "rev-parse", "--path-format=absolute", "--git-common-dir")
    if (!existsSync(`${commonDir}/info`)) {
      mkdirSync(`${commonDir}/info`, directoryMode)
    }
    mkdirSync(`${commonDir}/info/attributes`, directoryMode)
    return { base, head }
  })

const launchRefusedForBoth = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      const { base, head } = yield* refusedAndMoved(layout)
      const run = yield* cli(layout, ["implement", "--waive"])
      expect([run.status, failureTag(run)]).toEqual([1, "CommandRefused"])
      const printed = yield* Schema.decodeUnknownEffect(PrintedRefusal)(Arr.join(run.err, "\n"))
      expect(printed.reasons).toMatchObject([{ _tag: "WorktreeCheckFailed" }, { _tag: "HeadMoved", base, head }])
      expect(recorded(layout, "claude-launches")).toBeUndefined()
    }),
  )

const statusShowsBoth = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      const { base, head } = yield* refusedAndMoved(layout)
      const before = treeOf(layout.root)
      const run = yield* cli(layout, ["status"])
      expect([run.status, run.err]).toEqual([0, []])
      expect(treeOf(layout.root)).toEqual(before)
      const shown = Arr.join(run.out, "\n")
      expect(shown).toContain("AttributeSourcesRefused")
      expect(shown).toContain('"HeadMoved"')
      expect(shown).toContain(base)
      expect(shown).toContain(head)
    }),
  )

describe("a moved HEAD in production", () => {
  it.effect("status reports it and writes nothing", statusReportsMovedHead, endToEndMillis)
  it.effect("close --finished is refused for it, and close --abandoned still runs", finishRefusedAbandonAllowed, endToEndMillis)
})

describe("a moved HEAD beside a refused attribute source", () => {
  it.effect("a launch is refused for both", launchRefusedForBoth, endToEndMillis)
  it.effect("status shows both and writes nothing", statusShowsBoth, endToEndMillis)
})
