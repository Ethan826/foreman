// The owner's exits do not need HOME when a target is recorded (focused
// re-review finding 3; plan "Commands and their prerequisites", AC1).
// With a configuration that leaves out `ledgerDir`, the default ledger
// directory `<HOME>/.foreman` is resolved only when it is needed: with no
// binding recorded, or for a command that settles the configured target.
// With a binding, `step-ended` and `session close --abandoned |
// --interrupted` read it first and use its ledger. The test CLI's
// environment has no HOME.
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { readFileSync, rmSync } from "node:fs"
import { implementerEnded, interruptedAttempt } from "./interrupted-attempt.ts"
import {
  cli,
  type CliRun,
  configOf,
  endToEndMillis,
  failureTag,
  type Layout,
  openedSession,
  withLayout,
  writeConfig,
} from "./production-harness.ts"

/** Rewrites the layout's configuration without `ledgerDir`, so its default would need HOME. */
const withoutLedgerDir = (layout: Layout) => {
  const path = writeConfig(layout, configOf(layout, { ledgerDir: undefined }))
  expect(readFileSync(path, "utf8")).not.toContain("ledgerDir")
}

/** The exit status and the error tag, or the printed result's tag, of one run. */
const outcome = (run: CliRun) => [run.status, run.status === 0 ? printedTag(run) : failureTag(run)]

/** The first `_tag` in the JSON a successful run printed: the result's own. */
const printedTag = (run: CliRun): string => {
  const text = run.out.join("\n")
  return /"_tag": "([A-Za-z]+)"/.exec(text)?.[1] ?? text
}

const abandonedWithoutHome = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* openedSession(layout)
      withoutLedgerDir(layout)
      const run = yield* cli(layout, ["session", "close", "--abandoned"])
      expect(outcome(run)).toEqual([0, "SessionClosed"])
    }),
  )

const interruptedWithoutHome = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      const attempt = yield* interruptedAttempt(layout)
      withoutLedgerDir(layout)
      const ended = yield* cli(layout, ["step-ended", attempt.opId, "--grant", attempt.grantId])
      const closed = yield* cli(layout, ["session", "close", "--interrupted"])
      expect([ended, closed].map(outcome)).toEqual([
        [0, "StepEndedByOwner"],
        [0, "SessionClosed"],
      ])
      yield* implementerEnded(layout)
    }),
  )

const neededDefaultStillRefused = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* openedSession(layout)
      withoutLedgerDir(layout)
      const launch = yield* cli(layout, ["implement", "--waive"])
      rmSync(`${layout.state}/target-binding.json`, { recursive: false, force: false })
      const unbound = yield* cli(layout, ["session", "close", "--abandoned"])
      expect([launch, unbound].map(outcome)).toEqual([
        [1, "ConfigUndecodable"],
        [1, "ConfigUndecodable"],
      ])
      expect(launch.err.join("\n")).toContain("ledgerDir is not set and HOME is unset")
    }),
  )

describe("the owner's exits with no ledgerDir configured and HOME unset", () => {
  it.effect("session close --abandoned runs on the recorded binding's ledger", abandonedWithoutHome, endToEndMillis)
  it.live("step-ended and close --interrupted close an interrupted attempt", interruptedWithoutHome, endToEndMillis)
  it.effect("a launch, or an exit with no binding, still needs the default and fails", neededDefaultStillRefused, endToEndMillis)
})
