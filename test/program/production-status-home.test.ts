// `status` with no `ledgerDir` configured and HOME unset (follow-up
// review at 3b72efc, finding 4; owner ruling of 2026-11-20). The default
// ledger directory `<HOME>/.foreman` cannot be resolved, which status
// reports as a finding instead of failing before it reads the log. With
// a binding recorded it runs on the recorded target and reads that
// target's ledger; with none it shows the log and chooses no ledger. As
// for any finding, it runs no git command, so the worktree check is
// skipped. It writes nothing either way. The test CLI's environment has no HOME.
import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { readFileSync, rmSync } from "node:fs"
import {
  configOf,
  endToEndMillis,
  type Layout,
  openedSession,
  succeeded,
  withLayout,
  writeConfig,
} from "./production-harness.ts"
import { treeOf } from "./state-tree.ts"

/** The finding for the configured ledger directory that cannot be resolved without HOME. */
const ledgerUnresolved = {
  _tag: "ConfiguredLayoutRefused",
  reasons: ["cannot resolve the ledger directory: ledgerDir is not set and HOME is unset"],
}

/** The part of the printed report these tests read. */
const Shown = Schema.Struct({
  findings: Schema.Array(Schema.Unknown),
  target: Schema.Unknown,
  inForce: Schema.Struct({ _tag: Schema.String, binding: Schema.optional(Schema.Struct({ ledger: Schema.String })) }),
  report: Schema.Struct({
    state: Schema.Struct({ _tag: Schema.String }),
    ledgerFound: Schema.Boolean,
    worktree: Schema.Struct({ passed: Schema.Boolean, detail: Schema.String }),
  }),
})

/** The state and ledger directories as they are now, but `-shm` (owner ruling on B11; state-tree.ts). */
const stateTree = (layout: Layout) => [treeOf(layout.state), treeOf(layout.ledgerDir)]

/** Rewrites the layout's configuration without `ledgerDir`, so its default would need HOME. */
const withoutLedgerDir = (layout: Layout) => {
  const path = writeConfig(layout, configOf(layout, { ledgerDir: undefined }))
  expect(readFileSync(path, "utf8")).not.toContain("ledgerDir")
}

/** Runs `status` and decodes what it printed. */
const shownStatus = (layout: Layout) =>
  Effect.flatMap(succeeded(layout, ["status"]), (run) =>
    Schema.decodeUnknownEffect(Schema.fromJsonString(Shown))(run.out.join("\n")),
  )

const boundRunsOnRecorded = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* openedSession(layout)
      withoutLedgerDir(layout)
      const before = stateTree(layout)
      const shown = yield* shownStatus(layout)
      expect(shown.findings).toEqual([ledgerUnresolved])
      expect(shown.target).toEqual({ _tag: "TargetUncompared", binding: `${layout.state}/target-binding.json` })
      expect(shown.inForce).toMatchObject({ _tag: "RecordedInForce", binding: { ledger: `${layout.ledgerDir}/ledger.sqlite` } })
      expect(shown.report).toMatchObject({ state: { _tag: "OpenNoAttempt" }, ledgerFound: true })
      expect(shown.report.worktree).toEqual({ passed: false, detail: "a layout is refused; worktree check skipped" })
      expect(stateTree(layout)).toEqual(before)
    }),
  )

const unboundShowsLog = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* openedSession(layout)
      withoutLedgerDir(layout)
      rmSync(`${layout.state}/target-binding.json`, { recursive: false, force: false })
      const before = stateTree(layout)
      const shown = yield* shownStatus(layout)
      expect(shown.findings).toEqual([ledgerUnresolved])
      expect(shown.target).toEqual({ _tag: "TargetUnbound" })
      expect(shown.inForce).toEqual({ _tag: "NoTargetInForce" })
      expect(shown.report).toMatchObject({ state: { _tag: "OpenNoAttempt" }, ledgerFound: false })
      expect(shown.report.worktree.passed).toBe(false)
      expect(stateTree(layout)).toEqual(before)
    }),
  )

describe("status with no ledgerDir configured and HOME unset", () => {
  it.effect("reports the unresolved ledger directory and runs on the recorded binding", boundRunsOnRecorded, endToEndMillis)
  it.effect("without a binding, shows the log and chooses no ledger", unboundShowsLog, endToEndMillis)
})
