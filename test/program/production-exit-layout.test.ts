// The owner's exits do not depend on the configured layout (plan
// "Commands and their prerequisites", AC1; focused review finding 2).
// `step-ended` and `session close --abandoned | --interrupted` run on the
// recorded target when one is recorded, as `status` does, so a configured
// layout that breaks a rule blocks none of them. With no binding recorded
// the configured target is the one in force, and its layout is still
// checked. A command that acts on the target refuses a configured target
// that differs from the recorded one with `TargetMismatch`, compared
// before the layout rules (owner ruling, dogfood-2b). `step-ended` opens
// the log and the lock only, never the ledger.
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { implementerEnded, interruptedAttempt } from "./interrupted-attempt.ts"
import {
  cli,
  type CliRun,
  configOf,
  endToEndMillis,
  failureTag,
  type Layout,
  ledgerPath,
  openedSession,
  withLayout,
  writeConfig,
} from "./production-harness.ts"

/** A configuration whose supervisor worktree lies inside the owner's checkout, which the layout rules refuse. */
const nestedConfig = (layout: Layout) =>
  writeConfig(
    layout,
    configOf(layout, { supervisor: { path: `${layout.owner}/nested`, name: "t" } }),
    `${layout.root}/nested.json`,
  )

/** The state directory's target binding. */
const bindingOf = (layout: Layout) => `${layout.state}/target-binding.json`

/** The exit status and the error tag, or the printed result's tag, of one run. */
const outcome = (run: CliRun) => [run.status, run.status === 0 ? printedTag(run) : failureTag(run)]

/** The first `_tag` in the JSON a successful run printed: the result's own. */
const printedTag = (run: CliRun): string => {
  const text = run.out.join("\n")
  return /"_tag": "([A-Za-z]+)"/.exec(text)?.[1] ?? text
}

/** Removes the ledger file and its SQLite companions. */
const removeLedger = (layout: Layout) => {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${ledgerPath(layout)}${suffix}`, { recursive: false, force: true })
}

const abandonedDespiteLayout = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* openedSession(layout)
      const config = nestedConfig(layout)
      const run = yield* cli(layout, ["session", "close", "--abandoned", "--note", "layout broken"], { config })
      expect(outcome(run)).toEqual([0, "SessionClosed"])
    }),
  )

const interruptedDespiteLayout = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      const attempt = yield* interruptedAttempt(layout)
      const config = nestedConfig(layout)
      const ended = yield* cli(layout, ["step-ended", attempt.opId, "--grant", attempt.grantId], { config })
      const closed = yield* cli(layout, ["session", "close", "--interrupted"], { config })
      expect([ended, closed].map(outcome)).toEqual([
        [0, "StepEndedByOwner"],
        [0, "SessionClosed"],
      ])
      yield* implementerEnded(layout)
    }),
  )

const stepEndedLeavesLedger = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* openedSession(layout)
      removeLedger(layout)
      const run = yield* cli(layout, ["step-ended", "op-unknown", "--grant", "grant-unknown"])
      expect(outcome(run)).toEqual([1, "CommandRefused"])
      expect(existsSync(ledgerPath(layout))).toBe(false)
    }),
  )

const unboundStillChecked = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      const config = nestedConfig(layout)
      const runs = [
        yield* cli(layout, ["session", "close", "--abandoned"], { config }),
        yield* cli(layout, ["step-ended", "op-unknown", "--grant", "grant-unknown"], { config }),
      ]
      expect(runs.map(outcome)).toEqual([
        [1, "LayoutRefused"],
        [1, "LayoutRefused"],
      ])
    }),
  )

const recordedLayoutStillChecked = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* openedSession(layout)
      const recorded = readFileSync(bindingOf(layout), "utf8")
      const moved = recorded.replace(JSON.stringify(layout.supervisor), JSON.stringify(`${layout.owner}/nested`))
      expect(moved).not.toBe(recorded)
      writeFileSync(bindingOf(layout), moved)
      const runs = [
        yield* cli(layout, ["session", "close", "--abandoned"]),
        yield* cli(layout, ["step-ended", "op-unknown", "--grant", "grant-unknown"]),
      ]
      expect(runs.map(outcome)).toEqual(runs.map(() => [1, "LayoutRefused"]))
    }),
  )

const damagedBindingWithholds = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* openedSession(layout)
      writeFileSync(bindingOf(layout), "{ damaged")
      const runs = [
        yield* cli(layout, ["session", "close", "--abandoned"]),
        yield* cli(layout, ["step-ended", "op-unknown", "--grant", "grant-unknown"]),
      ]
      expect(runs.map(outcome)).toEqual(runs.map(() => [1, "TargetBindingUnreadable"]))
    }),
  )

const targetCommandsStillRefused = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* openedSession(layout)
      const config = nestedConfig(layout)
      const runs = [
        yield* cli(layout, ["implement", "--waive"], { config }),
        yield* cli(layout, ["session", "close", "--finished", "--attest"], { config }),
      ]
      expect(runs.map(outcome)).toEqual(runs.map(() => [1, "TargetMismatch"]))
    }),
  )

describe("the owner's exits in production with a refused configured layout", () => {
  it.effect("session close --abandoned closes on the recorded target", abandonedDespiteLayout, endToEndMillis)
  it.live("step-ended and close --interrupted close an interrupted attempt", interruptedDespiteLayout, endToEndMillis)
  it.effect("step-ended never opens the ledger", stepEndedLeavesLedger, endToEndMillis)
  it.effect("with no binding recorded, the configured layout is still refused", unboundStillChecked, endToEndMillis)
  it.effect("a recorded target whose layout is refused is still refused", recordedLayoutStillChecked, endToEndMillis)
  it.effect("a damaged binding still withholds every exit", damagedBindingWithholds, endToEndMillis)
  it.effect("a command that acts on a changed target is refused by the mismatch", targetCommandsStillRefused, endToEndMillis)
})
