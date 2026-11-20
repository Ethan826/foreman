// `status`'s advisory process evidence and coverage statement (review
// items B12 and M01): evidence for every attempt of the open session,
// finished ones included, since a leader's normal exit does not show
// that its descendants stopped; an attempt with `Intended` but no
// `Launched` is unknown and may be running, because the client is spawned
// before batch L; the caveats stay; and the snapshot coverage statement
// that review briefs carry is in the report too.
import { describe, expect, it } from "@effect/vitest"
import { Effect, Option, Schema } from "effect"
import { Launched, ProjectLogError } from "../../src/domain/events.ts"
import { snapshotCoverage } from "../../src/format/brief.ts"
import { implement } from "../../src/program/implement.ts"
import { evidenceCaveat, status } from "../../src/program/status.ts"
import { fakePid, fakeStartedAt } from "../fixtures/clients/fake-client.ts"
import type { Harness } from "./session-harness.ts"
import { withHarness } from "./session-harness.ts"
import { firstIntent, opened } from "./session-steps.ts"

/** A pid the fake leader's descendant has, still in the leader's group. */
const descendantPid = 5151

/** A listing with the descendant in the recorded group and no leader row. */
const descendantOnly =
  "  PID  PGID STARTED                      COMMAND\n" +
  ` ${String(descendantPid)} ${String(fakePid)} ${fakeStartedAt} sh -c sleep\n`

/** The harness's context with `listing` as the process listing. */
const listing = (harness: Harness, text: string) => ({
  ...harness.status,
  capabilities: { ...harness.status.capabilities, readProcesses: () => Effect.succeed(text) },
})

const finishedLeaderWithDescendant = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    yield* implement(harness.context, { waive: false })
    const intent = yield* firstIntent(harness)
    const report = yield* status(listing(harness, descendantOnly))
    expect(report.state).toMatchObject({ _tag: "AwaitingHandoff" })
    expect(report.incomplete).toEqual([])
    expect(report.launches).toMatchObject([
      {
        opId: intent.opId,
        finished: true,
        evidence: {
          _tag: "ProcessesListed",
          leader: { _tag: "LeaderNotListed" },
          members: [{ pid: descendantPid, pgid: fakePid }],
        },
      },
    ])
    expect(report.evidenceCaveat).toBe(evidenceCaveat)
  })

const spawnedBeforeBatchL = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    harness.inject.appendFails = Option.some((events) =>
      events.some(Schema.is(Launched)) ? Option.some(new ProjectLogError({ reason: "crash" })) : Option.none(),
    )
    yield* Effect.exit(implement(harness.context, { waive: false }))
    expect(harness.client.launches).toHaveLength(1)
    const intent = yield* firstIntent(harness)
    const report = yield* status(harness.status)
    expect(report.incomplete).toEqual([{ opId: intent.opId, grantId: intent.grantId }])
    expect(report.launches).toMatchObject([
      { opId: intent.opId, finished: false, launched: Option.none(), evidence: { _tag: "LaunchUnknown" } },
    ])
  })

const showsCoverage = (harness: Harness) =>
  Effect.gen(function* () {
    expect((yield* status(harness.status)).coverage).toBe(snapshotCoverage)
  })

describe("status evidence", () => {
  it.effect("lists a finished leader's group when a descendant outlives it", () =>
    withHarness({}, finishedLeaderWithDescendant),
  )
  it.effect("shows an Intended without Launched as unknown, possibly running", () =>
    withHarness({}, spawnedBeforeBatchL),
  )
  it.effect("keeps the reused-id, escaped-descendant and unrecorded-launch caveats", () =>
    Effect.sync(() => {
      expect(evidenceCaveat).toMatch(/reusing the id/)
      expect(evidenceCaveat).toMatch(/left the group is not listed/)
      expect(evidenceCaveat).toMatch(/spawned before its launch is recorded/)
    }),
  )
  it.effect("states the snapshot coverage, as review briefs do", () => withHarness({}, showsCoverage))
})
