// Attribute files through the production composition. The configuration
// may enable one line only, Waxwing's `*.wxw linguist-language=Rust`, in
// the root `.gitattributes`, and only for the target it is bound to
// (batch review B06; owner decision M09). After staging, the candidate
// tree's own `.gitattributes` blobs are judged by the same rule, from
// their contents, before any client gets the candidate; and the startup
// check judges the session's base, or the worktree's HEAD before a
// session, not the base the worktree was created at (batch review B07).
// A HEAD that moved since the session opened refuses the launch (owner
// ruling of 2026-11-23).
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Effect, Schema } from "effect"
import { existsSync, writeFileSync } from "node:fs"
import { git } from "../runtime/git-repo.ts"
import { commitAttributes } from "./attribute-fixtures.ts"
import { commitFile, markerScript } from "./git-hazard-fixtures.ts"
import {
  cli,
  configOf,
  endToEndMillis,
  failureTag,
  type Layout,
  openedSession,
  recorded,
  succeeded,
  withLayout,
  writeConfig,
} from "./production-harness.ts"

/** Waxwing's one approved line. */
const waxwingLine = "*.wxw linguist-language=Rust"

/** A configuration whose allowance names `rootLines`. */
const allowing = (layout: Layout, rootLines: ReadonlyArray<string>) =>
  writeConfig(layout, configOf(layout, { attributeAllowance: { rootLines } }))

const configuredLineRefused = (rootLines: ReadonlyArray<string>) => () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      allowing(layout, rootLines)
      const run = yield* cli(layout, ["worktree", "create"])
      expect([run.status, failureTag(run)]).toEqual([1, "ConfigUndecodable"])
    }),
  )

const waxwingLineAllowed = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* commitAttributes(layout.owner, ".gitattributes", `# Waxwing\n${waxwingLine}\n`)
      allowing(layout, [waxwingLine])
      yield* openedSession(layout)
    }),
  )

const waxwingLineRefusedWithoutAllowance = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* commitAttributes(layout.owner, ".gitattributes", `${waxwingLine}\n`)
      const run = yield* cli(layout, ["worktree", "create"])
      expect([run.status, failureTag(run)]).toEqual([1, "AttributeSourcesRefused"])
    }),
  )

const allowanceOnlyForBoundTarget = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* openedSession(layout)
      allowing(layout, [waxwingLine])
      const run = yield* cli(layout, ["implement", "--waive"])
      expect([run.status, failureTag(run)]).toEqual([1, "TargetMismatch"])
    }),
  )

describe("the configured attribute allowance", () => {
  it.effect("a conversion line is refused at decoding", configuredLineRefused(["* text=auto"]), endToEndMillis)
  it.effect("a filter line is refused at decoding", configuredLineRefused(["*.txt filter=evil"]), endToEndMillis)
  it.effect("a macro line is refused at decoding", configuredLineRefused(["[attr]binary -diff -merge -text"]), endToEndMillis)
  it.effect("a near miss of Waxwing's line is refused at decoding", configuredLineRefused([`${waxwingLine} filter=x`]), endToEndMillis)
  it.effect("Waxwing's line twice is refused at decoding", configuredLineRefused([waxwingLine, waxwingLine]), endToEndMillis)
  it.effect("Waxwing's line, when allowed, passes creation and the startup check", waxwingLineAllowed, endToEndMillis)
  it.effect("Waxwing's line is refused without the allowance", waxwingLineRefusedWithoutAllowance, endToEndMillis)
  it.effect("the allowance cannot be enabled for a state directory bound without it", allowanceOnlyForBoundTarget, endToEndMillis)
})

/** A shell action for the fake Claude: writes `content` to `path` in its working directory. */
const writing = (path: string, content: string) => `mkdir -p "$(dirname '${path}')" && printf '%s' '${content}' > '${path}'`

/**
 * Opens a session, lets the implementer write `path` with `content`, and
 * runs `review`; returns the review's run. `prepare` runs first.
 */
const reviewedAfterWriting = (layout: Layout, path: string, content: string) =>
  Effect.gen(function* () {
    yield* openedSession(layout)
    yield* succeeded(layout, ["implement", "--waive"], { env: { FAKE_EDIT: writing(path, content) } })
    return yield* cli(layout, ["review", "--waive", "--attest"])
  })

const candidateRefused = (path: string, content: string, rootLines: ReadonlyArray<string> = []) => () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      allowing(layout, rootLines)
      const run = yield* reviewedAfterWriting(layout, path, content)
      expect([run.status, failureTag(run)]).toEqual([1, "AttributeSourcesRefused"])
      expect(recorded(layout, "codex-launches")).toBeUndefined()
    }),
  )

const editedRootRefused = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* commitAttributes(layout.owner, ".gitattributes", "# no attributes yet\n")
      const run = yield* reviewedAfterWriting(layout, ".gitattributes", "# no attributes yet\n*.txt eol=crlf\n")
      expect([run.status, failureTag(run)]).toEqual([1, "AttributeSourcesRefused"])
      expect(recorded(layout, "codex-launches")).toBeUndefined()
    }),
  )

const candidateFilterNotRun = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* commitFile(layout.owner)
      const marker = `${layout.root}/filter.marker`
      const filter = markerScript(`${layout.root}/filter.sh`, marker, "cat\n")
      yield* git(layout.owner, "config", "filter.mark.clean", filter)
      yield* git(layout.owner, "config", "filter.mark.smudge", filter)
      const run = yield* reviewedAfterWriting(layout, ".gitattributes", "* filter=mark\n")
      expect([run.status, failureTag(run)]).toEqual([1, "AttributeSourcesRefused"])
      expect(existsSync(marker)).toBe(false)
    }),
  )

const waxwingCandidatePasses = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      allowing(layout, [waxwingLine])
      const run = yield* reviewedAfterWriting(layout, ".gitattributes", `${waxwingLine}\n`)
      expect(run.status).toBe(0)
      expect(recorded(layout, "codex-launches")).toBe("ran\n")
    }),
  )

/** Commits `content` as the supervisor branch's root `.gitattributes`, moving the worktree's HEAD. */
const commitInWorktree = (layout: Layout, content: string) =>
  Effect.gen(function* () {
    writeFileSync(`${layout.supervisor}/.gitattributes`, content)
    yield* git(layout.supervisor, "add", ".gitattributes")
    yield* git(layout.supervisor, "commit", "--quiet", "-m", "attributes")
  })

const openJudgesCurrentHead = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* succeeded(layout, ["worktree", "create"])
      yield* commitInWorktree(layout, "* text\n")
      const run = yield* cli(layout, ["session", "open", "--tranche", "t-1", "--task", layout.taskFile])
      expect([run.status, failureTag(run)]).toEqual([1, "CommandRefused"])
      const status = yield* succeeded(layout, ["status"])
      expect(status.out.join("\n")).toContain("AttributeSourcesRefused")
    }),
  )

/** The refusal a failed run printed on stderr: its tag and its reasons. */
const PrintedRefusal = Schema.fromJsonString(Schema.Struct({ _tag: Schema.String, reasons: Schema.Array(Schema.Unknown) }))

/**
 * The commit moves HEAD to a tree whose root `.gitattributes` would be
 * refused. Judged at the session's base, the attribute check passes, so
 * the only reason is the moved HEAD (owner ruling of 2026-11-23).
 */
const launchRefusesMovedHead = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* openedSession(layout)
      const base = yield* git(layout.supervisor, "rev-parse", "HEAD")
      yield* commitInWorktree(layout, "* text\n")
      const head = yield* git(layout.supervisor, "rev-parse", "HEAD")
      const run = yield* cli(layout, ["implement", "--waive"])
      expect([run.status, failureTag(run)]).toEqual([1, "CommandRefused"])
      const printed = yield* Schema.decodeUnknownEffect(PrintedRefusal)(Arr.join(run.err, "\n"))
      expect(printed.reasons).toMatchObject([{ _tag: "HeadMoved", base, head }])
      expect(Arr.join(run.err, "\n")).not.toContain("WorktreeCheckFailed")
      expect(Arr.join(run.err, "\n")).not.toContain("AttributeSourcesRefused")
      expect(recorded(layout, "claude-launches")).toBeUndefined()
    }),
  )

describe("the candidate tree's attribute files", () => {
  it.effect("an added root file with a conversion is refused before review launches", candidateRefused(".gitattributes", "* text\n"), endToEndMillis)
  it.effect("an edited root file is refused before review launches", editedRootRefused, endToEndMillis)
  it.effect("an added macro is refused before review launches", candidateRefused(".gitattributes", "[attr]x text\n"), endToEndMillis)
  it.effect(
    "a nested file with Waxwing's line is refused even when the root may hold it",
    candidateRefused("sub/.gitattributes", `${waxwingLine}\n`, [waxwingLine]),
    endToEndMillis,
  )
  it.effect("a candidate filter is judged from the blob and never run", candidateFilterNotRun, endToEndMillis)
  it.effect("Waxwing's line added to the root passes when allowed", waxwingCandidatePasses, endToEndMillis)
})

describe("the startup check's base", () => {
  it.effect("session open judges the worktree's HEAD, not the base it was created at", openJudgesCurrentHead, endToEndMillis)
  it.effect(
    "a launch refuses a HEAD that moved since the session opened, while the attribute check still judges the session's base",
    launchRefusesMovedHead,
    endToEndMillis,
  )
})
