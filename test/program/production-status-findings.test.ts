// `status` reports a broken target or layout beside whatever state it
// can read safely (re-review R03; plan "Commands and their
// prerequisites", AC1). A refused configured layout, a damaged binding
// and a refused recorded layout are each a finding in the output, and
// status still shows the project log's session state, its incomplete
// attempts and their process evidence. It runs git only when no layout
// is refused, never guesses a replacement target, takes no lock and
// writes nothing: every file under the layout keeps its bytes and times,
// except SQLite's `-shm` coordination file (owner ruling on B11).
import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { readFileSync, writeFileSync } from "node:fs"
import { implementerEnded, interruptedAttempt } from "./interrupted-attempt.ts"
import { cli, configOf, endToEndMillis, type Layout, openedSession, withLayout, writeConfig } from "./production-harness.ts"
import { treeOf } from "./state-tree.ts"

const bindingOf = (layout: Layout) => `${layout.state}/target-binding.json`

/** The part of the printed report these tests read; the findings and target readings are compared as printed. */
const Shown = Schema.Struct({
  findings: Schema.Array(Schema.Unknown),
  target: Schema.Unknown,
  inForce: Schema.Unknown,
  report: Schema.Struct({
    state: Schema.Unknown,
    ledgerFound: Schema.Boolean,
    incomplete: Schema.Array(Schema.Struct({ opId: Schema.String, grantId: Schema.String })),
    launches: Schema.Array(Schema.Struct({ opId: Schema.String, finished: Schema.Boolean })),
    worktree: Schema.Struct({ passed: Schema.Boolean, detail: Schema.String }),
  }),
})

/**
 * Runs `status`, expects exit status 0, decodes what it printed, and
 * expects every file under the layout unchanged but `-shm`.
 */
const shownUnchanged = (layout: Layout) =>
  Effect.gen(function* () {
    const before = treeOf(layout.root)
    const run = yield* cli(layout, ["status"])
    expect([run.status, run.err]).toEqual([0, []])
    expect(treeOf(layout.root)).toEqual(before)
    return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Shown))(run.out.join("\n"))
  })

/** Whether the worktree check was skipped, so no git command ran. */
const expectSkipped = (worktree: { readonly passed: boolean; readonly detail: string }) => {
  expect(worktree.passed).toBe(false)
  expect(worktree.detail).toContain("worktree check skipped")
}

const configuredLayoutReported = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      const attempt = yield* interruptedAttempt(layout)
      yield* implementerEnded(layout)
      writeConfig(layout, configOf(layout, { supervisor: { path: `${layout.owner}/nested`, name: "t" } }))
      const shown = yield* shownUnchanged(layout)
      expect(shown.findings).toMatchObject([{ _tag: "ConfiguredLayoutRefused" }])
      expect(shown.findings).toHaveLength(1)
      expect(shown.target).toMatchObject({ _tag: "TargetMismatch", binding: bindingOf(layout) })
      expect(shown.inForce).toMatchObject({ _tag: "RecordedInForce" })
      expect(shown.report.state).toMatchObject({ _tag: "AttemptIncomplete" })
      expect(shown.report.incomplete).toEqual([attempt])
      expect(shown.report.launches).toEqual([{ opId: attempt.opId, finished: false }])
      expect(shown.report.ledgerFound).toBe(true)
      expectSkipped(shown.report.worktree)
    }),
  )

const damagedBindingReported = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* openedSession(layout)
      writeFileSync(bindingOf(layout), "{ damaged")
      const shown = yield* shownUnchanged(layout)
      expect(shown.findings).toMatchObject([{ _tag: "TargetBindingUnreadable", binding: bindingOf(layout) }])
      expect(shown.findings).toHaveLength(1)
      expect(shown.target).toEqual({ _tag: "TargetUncompared", binding: bindingOf(layout) })
      expect(shown.inForce).toMatchObject({ _tag: "NoTargetInForce" })
      expect(shown.report.state).toMatchObject({ _tag: "OpenNoAttempt" })
      expect(shown.report.ledgerFound).toBe(false)
      expectSkipped(shown.report.worktree)
      expect(readFileSync(bindingOf(layout), "utf8")).toBe("{ damaged")
    }),
  )

const recordedLayoutReported = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* openedSession(layout)
      const recorded = readFileSync(bindingOf(layout), "utf8")
      const moved = recorded.replace(JSON.stringify(layout.supervisor), JSON.stringify(`${layout.owner}/nested`))
      expect(moved).not.toBe(recorded)
      writeFileSync(bindingOf(layout), moved)
      const shown = yield* shownUnchanged(layout)
      expect(shown.findings).toMatchObject([{ _tag: "RecordedLayoutRefused", binding: bindingOf(layout) }])
      expect(shown.findings).toHaveLength(1)
      expect(shown.target).toMatchObject({ _tag: "TargetMismatch", binding: bindingOf(layout) })
      expect(shown.inForce).toMatchObject({ _tag: "NoTargetInForce" })
      expect(shown.report.state).toMatchObject({ _tag: "OpenNoAttempt" })
      expect(shown.report.ledgerFound).toBe(false)
      expectSkipped(shown.report.worktree)
    }),
  )

describe("status in production under a broken target or layout", () => {
  it.live("a refused configured layout is a finding beside the session, its attempts and their evidence", configuredLayoutReported, endToEndMillis)
  it.effect("a damaged binding is a finding, and status runs on no target", damagedBindingReported, endToEndMillis)
  it.effect("a refused recorded layout is a finding, and status runs on no target", recordedLayoutReported, endToEndMillis)
})
