// A recorded binding is consulted before any store directory is touched
// (owner finding F10, dogfood-2). With a binding recorded and the
// configured `ledgerDir` changed, a command that acts on the target fails
// with `TargetMismatch` and creates nothing, whether the new ledger
// directory's parent exists or not, and also where the layout check would
// refuse the new path, since the binding is compared before the layout
// rules (dogfood-2b round 2). An abandoned close stays reachable on the
// recorded target without touching the configured path. A recorded
// binding whose ledger path is not absolute is refused as
// `TargetBindingUnreadable`, saying so, by `status` and by an owner close
// (owner finding F11, dogfood-2).
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Effect, Schema, String } from "effect"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import {
  cli,
  configOf,
  endToEndMillis,
  failureTag,
  type Layout,
  ledgerPath,
  openedSession,
  succeeded,
  withLayout,
  writeConfig,
} from "./production-harness.ts"

/** The binding file of `layout`'s state directory. */
const bindingOf = (layout: Layout) => `${layout.state}/target-binding.json`

/** Where a changed configuration puts the ledger, and the top directory it would create. */
interface ChangedLedger {
  readonly ledgerDir: (layout: Layout) => string
  readonly created: (layout: Layout) => string
}

/** A new ledger directory whose parent, the layout's root, exists. */
const parentPresent: ChangedLedger = {
  ledgerDir: (layout) => `${layout.root}/ledger2`,
  created: (layout) => `${layout.root}/ledger2`,
}

/** A new ledger directory whose parent is missing too. */
const parentMissing: ChangedLedger = {
  ledgerDir: (layout) => `${layout.root}/absent/ledger2`,
  created: (layout) => `${layout.root}/absent`,
}

/**
 * With a session open, so a binding is recorded, runs `words` under a
 * configuration whose `ledgerDir` is changed: expects `TargetMismatch`
 * and nothing created at the new path.
 */
const mismatchFirst = (words: ReadonlyArray<string>, change: ChangedLedger) => () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* openedSession(layout)
      const config = writeConfig(layout, configOf(layout, { ledgerDir: change.ledgerDir(layout) }), `${layout.root}/copied.json`)
      const run = yield* cli(layout, words, { config })
      expect([run.status, failureTag(run)]).toEqual([1, "TargetMismatch"])
      expect(existsSync(change.created(layout))).toBe(false)
    }),
  )

/**
 * With a session open and the configured `ledgerDir` changed to a path
 * inside the supervisor worktree, which the layout check refuses, a
 * session command compares the recorded binding first: it fails with
 * `TargetMismatch`, not `LayoutRefused`, and creates nothing at the new
 * path (owner finding F10, dogfood-2b round 2).
 */
const mismatchBeforeLayout = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* openedSession(layout)
      const ledgerDir = `${layout.supervisor}/new-ledger`
      const config = writeConfig(layout, configOf(layout, { ledgerDir }), `${layout.root}/copied.json`)
      const run = yield* cli(layout, ["worktree", "create"], { config })
      expect([run.status, failureTag(run)]).toEqual([1, "TargetMismatch"])
      expect(existsSync(ledgerDir)).toBe(false)
    }),
  )

/**
 * With a binding recorded and the configured `ledgerDir` changed, an
 * abandoned close stays reachable: it runs on the recorded target, never
 * fails with `TargetMismatch`, and creates nothing at the configured path
 * (owner ruling, dogfood-2b round 2).
 */
const exitLeavesConfiguredLedger = (change: ChangedLedger) => () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* openedSession(layout)
      const config = writeConfig(layout, configOf(layout, { ledgerDir: change.ledgerDir(layout) }), `${layout.root}/copied.json`)
      yield* succeeded(layout, ["session", "close", "--abandoned"], { config })
      expect(existsSync(change.created(layout))).toBe(false)
    }),
  )

/** Rewrites the recorded binding so its ledger path is the bare file name `usage.sqlite`. */
const relativeLedgerRecorded = (layout: Layout) => {
  const recorded = readFileSync(bindingOf(layout), "utf8")
  const relative = String.replace(JSON.stringify(ledgerPath(layout)), JSON.stringify("usage.sqlite"))(recorded)
  expect(relative).not.toBe(recorded)
  writeFileSync(bindingOf(layout), relative)
}

/** What `status` printed: its findings and the target in force. */
const Shown = Schema.Struct({
  findings: Schema.Array(Schema.Struct({ _tag: Schema.String, binding: Schema.String, reason: Schema.String })),
  inForce: Schema.Struct({ _tag: Schema.String }),
})

const relativeLedgerRefusedByStatus = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* openedSession(layout)
      relativeLedgerRecorded(layout)
      const run = yield* cli(layout, ["status"])
      expect([run.status, run.err]).toEqual([0, []])
      const shown = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Shown))(Arr.join(run.out, "\n"))
      expect(shown.findings).toEqual([
        {
          _tag: "TargetBindingUnreadable",
          binding: bindingOf(layout),
          reason: `the ledger path ${JSON.stringify("usage.sqlite")} is not absolute`,
        },
      ])
      expect(shown.inForce).toEqual({ _tag: "NoTargetInForce" })
    }),
  )

const relativeLedgerRefusedByClose = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* openedSession(layout)
      relativeLedgerRecorded(layout)
      const run = yield* cli(layout, ["session", "close", "--abandoned"])
      expect([run.status, failureTag(run)]).toEqual([1, "TargetBindingUnreadable"])
      expect(Arr.join(run.err, "\n")).toContain("is not absolute")
    }),
  )

/** A session command and the owner's finished close, both built by production. */
const sessionCommand = ["worktree", "create"]
const ownerClose = ["session", "close", "--finished", "--attest"]

describe("a recorded binding before the store directories in production", () => {
  it.effect("a session command with a changed ledger refuses the mismatch and creates nothing", mismatchFirst(sessionCommand, parentPresent), endToEndMillis)
  it.effect("a session command with a changed ledger whose parent is missing refuses the mismatch", mismatchFirst(sessionCommand, parentMissing), endToEndMillis)
  it.effect("an owner close with a changed ledger refuses the mismatch and creates nothing", mismatchFirst(ownerClose, parentPresent), endToEndMillis)
  it.effect("an owner close with a changed ledger whose parent is missing refuses the mismatch", mismatchFirst(ownerClose, parentMissing), endToEndMillis)
  it.effect("a session command with a changed ledger the layout refuses still reports the mismatch", mismatchBeforeLayout, endToEndMillis)
  it.effect("an abandoned close stays reachable under a changed ledgerDir and creates nothing there", exitLeavesConfiguredLedger(parentPresent), endToEndMillis)
  it.effect("an abandoned close stays reachable under a changed ledgerDir with a missing parent and creates nothing there", exitLeavesConfiguredLedger(parentMissing), endToEndMillis)
})

describe("a recorded binding with a relative ledger path in production", () => {
  it.effect("status reports it as an unreadable binding that says why", relativeLedgerRefusedByStatus, endToEndMillis)
  it.effect("an owner close refuses it as an unreadable binding", relativeLedgerRefusedByClose, endToEndMillis)
})
