// The owner's exits through the production composition do not depend on
// git's private HOME (re-review R02; plan "Commands and their
// prerequisites", AC1): `step-ended` and `session close --abandoned |
// --interrupted` run no git command, so a contaminated
// `<stateDir>/git-home` blocks none of them, and each still refuses what
// its own rules refuse. Every command that runs git still refuses that
// HOME with `GitHomeRefused` (batch review B02).
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { readdirSync, writeFileSync } from "node:fs"
import { setVersion, versionOf } from "../runtime/store-version-fixtures.ts"
import { implementerEnded, interruptedAttempt } from "./interrupted-attempt.ts"
import {
  cli,
  type CliRun,
  endToEndMillis,
  failureTag,
  type Layout,
  ledgerPath,
  openedSession,
  recorded,
  withLayout,
} from "./production-harness.ts"
import { treeOf } from "./state-tree.ts"

const homeOf = (layout: Layout) => `${layout.state}/git-home`

/** Plants one file in git's HOME, which B02 refuses for every git command. */
const contaminate = (layout: Layout) => {
  writeFileSync(`${homeOf(layout)}/.gitconfig`, "[user]\n\tname = planted\n")
}

/** The exit status and the error tag, or the printed result's tag, of one run. */
const outcome = (run: CliRun) => [run.status, run.status === 0 ? printedTag(run) : failureTag(run)]

/** The first `_tag` in the JSON a successful run printed: the result's own. */
const printedTag = (run: CliRun): string => {
  const text = run.out.join("\n")
  return /"_tag": "([A-Za-z]+)"/.exec(text)?.[1] ?? text
}

const abandonedDespiteHome = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* openedSession(layout)
      contaminate(layout)
      const run = yield* cli(layout, ["session", "close", "--abandoned", "--note", "home planted"])
      expect(outcome(run)).toEqual([0, "SessionClosed"])
      expect(readdirSync(homeOf(layout))).toEqual([".gitconfig"])
    }),
  )

const exitsRefuseByTheirRules = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* openedSession(layout)
      contaminate(layout)
      const runs = [
        yield* cli(layout, ["step-ended", "op-unknown", "--grant", "grant-unknown"]),
        yield* cli(layout, ["session", "close", "--interrupted"]),
      ]
      expect(runs.map(outcome)).toEqual([
        [1, "CommandRefused"],
        [1, "CommandRefused"],
      ])
    }),
  )

const interruptedDespiteHome = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      const attempt = yield* interruptedAttempt(layout)
      contaminate(layout)
      const abandoned = yield* cli(layout, ["session", "close", "--abandoned"])
      const early = yield* cli(layout, ["session", "close", "--interrupted"])
      const ended = yield* cli(layout, ["step-ended", attempt.opId, "--grant", attempt.grantId])
      const closed = yield* cli(layout, ["session", "close", "--interrupted", "--note", "home planted"])
      expect([abandoned, early, ended, closed].map(outcome)).toEqual([
        [1, "CommandRefused"],
        [1, "CommandRefused"],
        [0, "StepEndedByOwner"],
        [0, "SessionClosed"],
      ])
      yield* implementerEnded(layout)
    }),
  )

const gitCommandsStillRefused = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* openedSession(layout)
      contaminate(layout)
      const runs = [
        yield* cli(layout, ["worktree", "create"]),
        yield* cli(layout, ["implement", "--waive"]),
        yield* cli(layout, ["session", "close", "--finished", "--attest"]),
      ]
      expect(runs.map(outcome)).toEqual(runs.map(() => [1, "GitHomeRefused"]))
      expect(recorded(layout, "claude-launches")).toBeUndefined()
    }),
  )

// A ledger stamped by a newer release refuses `session close --abandoned`,
// which must write it to settle (dogfood-5, owner ruling P4). The log is
// opened first, so a log at 0 is stamped 1 before the ledger is refused;
// the ruling accepts that, since 1 is the format the log already has.
const newerLedgerRefusesClose = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      const log = `${layout.state}/log.sqlite`
      yield* openedSession(layout)
      yield* setVersion(log, 0)
      yield* setVersion(ledgerPath(layout), 2)
      const before = treeOf(layout.ledgerDir)
      const run = yield* cli(layout, ["session", "close", "--abandoned"])
      expect(outcome(run)).toEqual([1, "StoreVersionNewer"])
      expect(treeOf(layout.ledgerDir)).toEqual(before)
      expect(yield* versionOf(ledgerPath(layout))).toBe(2)
      expect(yield* versionOf(log)).toBe(1)
    }),
  )

describe("the owner's exits in production over a newer ledger", () => {
  it.effect("session close --abandoned fails with StoreVersionNewer and leaves the ledger as it was", newerLedgerRefusesClose, endToEndMillis)
})

describe("the owner's exits in production with a contaminated git HOME", () => {
  it.effect("session close --abandoned closes the session", abandonedDespiteHome, endToEndMillis)
  it.effect("step-ended and close --interrupted still refuse what their rules refuse", exitsRefuseByTheirRules, endToEndMillis)
  it.live("step-ended and close --interrupted close an interrupted attempt", interruptedDespiteHome, endToEndMillis)
  it.effect("a command that runs git is still refused with GitHomeRefused", gitCommandsStillRefused, endToEndMillis)
})
