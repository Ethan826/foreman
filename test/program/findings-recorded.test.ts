// A usable review's findings in the log (v0.2.0, dogfood-6; design
// "Commands and events"): batch F of a review whose outcome is usable
// ends with `FindingsRecorded`, holding the decoded findings in the
// reviewer's order. A crashed or unclassified review records none, even
// when its final message holds a valid, non-empty findings block, and so
// does a review whose block repeats an id. An implement records none.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Effect, Option, Schema } from "effect"
import { FindingsRecorded, type ProjectEvent } from "../../src/domain/events.ts"
import { ChangesRequested, Crashed, Success, Unclassified } from "../../src/domain/outcomes.ts"
import { claudeSuccess } from "../fixtures/clients/claude-success.ts"
import { codexReviewClean } from "../fixtures/clients/codex-review-clean.ts"
import { codexReviewRepeatedId, codexReviewTwoFindings } from "../fixtures/clients/codex-review-two-findings.ts"
import { type ClientScript, exitedWith, killedBy } from "../fixtures/clients/fake-client.ts"
import { afterImplement, implemented, reviewed, sessionIdOf } from "./handoff-steps.ts"
import { eventsOf, type Harness, repositoryHarnessMillis, withHarness } from "./session-harness.ts"
import { opened } from "./session-steps.ts"

/** The two findings of the two-findings review's final message, decoded, in its order: F2, then F1. */
const twoFindings = [
  { id: "F2", severity: "major", file: Option.some("greeting.txt"), summary: "The greeting lacks a name." },
  { id: "F1", severity: "minor", file: Option.none(), summary: "The task asks for a period at the end." },
]

/** Expects the log to end with events tagged `tags`, in order: the end of the batch the last command wrote. */
const expectEndsWith = (events: ReadonlyArray<ProjectEvent>, ...tags: ReadonlyArray<string>) => {
  expect(Arr.takeRight(events, Arr.length(tags))).toMatchObject(Arr.map(tags, (tag) => ({ _tag: tag })))
}

/** The `FindingsRecorded` events in the log. */
const recordedFindings = (harness: Harness) =>
  Effect.map(eventsOf(harness), (events) => Arr.filter(events, Schema.is(FindingsRecorded)))

/** A review with the two-findings message whose leader was ended by a signal. */
const crashedWithFindings: ClientScript = { ...codexReviewTwoFindings, exit: killedBy("SIGTERM") }

/** A review with the two-findings message whose leader exited 1: unclassified. */
const failedWithFindings: ClientScript = { ...codexReviewTwoFindings, exit: exitedWith(1) }

const changesRequestedRecorded = (harness: Harness) =>
  Effect.gen(function* () {
    yield* afterImplement(harness)
    const recorded = yield* reviewed(harness, codexReviewTwoFindings)
    expect(recorded.outcome).toEqual(new ChangesRequested())
    const events = yield* eventsOf(harness)
    expectEndsWith(events, "Finished", "ReportRecorded", "FindingsRecorded")
    expect(Arr.last(events)).toEqual(
      Option.some(
        new FindingsRecorded({
          sessionId: yield* sessionIdOf(harness),
          reviewOpId: recorded.opId,
          findings: twoFindings,
        }),
      ),
    )
  })

const successRecordsEmpty = (harness: Harness) =>
  Effect.gen(function* () {
    yield* afterImplement(harness)
    const recorded = yield* reviewed(harness, codexReviewClean)
    expect(recorded.outcome).toEqual(new Success())
    const events = yield* eventsOf(harness)
    expectEndsWith(events, "Finished", "ReportRecorded", "FindingsRecorded")
    expect(Arr.last(events)).toEqual(
      Option.some(
        new FindingsRecorded({ sessionId: yield* sessionIdOf(harness), reviewOpId: recorded.opId, findings: [] }),
      ),
    )
  })

const crashedRecordsNone = (harness: Harness) =>
  Effect.gen(function* () {
    yield* afterImplement(harness)
    const recorded = yield* reviewed(harness, crashedWithFindings)
    expect(recorded.outcome).toEqual(new Crashed({ signal: "SIGTERM" }))
    expectEndsWith(yield* eventsOf(harness), "Finished", "ReportRecorded")
    expect(yield* recordedFindings(harness)).toEqual([])
  })

const unclassifiedRecordsNone = (harness: Harness) =>
  Effect.gen(function* () {
    yield* afterImplement(harness)
    const recorded = yield* reviewed(harness, failedWithFindings)
    expect(recorded.outcome).toEqual(new Unclassified())
    expectEndsWith(yield* eventsOf(harness), "Finished", "ReportRecorded")
    expect(yield* recordedFindings(harness)).toEqual([])
  })

const repeatedIdRecordsNone = (harness: Harness) =>
  Effect.gen(function* () {
    yield* afterImplement(harness)
    const recorded = yield* reviewed(harness, codexReviewRepeatedId)
    expect(recorded.outcome).toEqual(new Unclassified())
    expectEndsWith(yield* eventsOf(harness), "Finished", "ReportRecorded")
    expect(yield* recordedFindings(harness)).toEqual([])
  })

const implementRecordsNone = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    const recorded = yield* implemented(harness, claudeSuccess)
    expect(recorded.outcome).toEqual(new Success())
    expectEndsWith(yield* eventsOf(harness), "Finished", "ReportRecorded")
    expect(yield* recordedFindings(harness)).toEqual([])
    expect(harness.gitCalls).toEqual([])
  })

describe("FindingsRecorded in batch F", () => {
  it.effect("records a ChangesRequested review's findings in order, after Finished and ReportRecorded", () =>
    withHarness({ repository: true }, changesRequestedRecorded), repositoryHarnessMillis,
  )
  it.effect("records a Success review's empty list", () =>
    withHarness({ repository: true }, successRecordsEmpty), repositoryHarnessMillis)
  it.effect("records none for a crashed review whose final message holds valid findings", () =>
    withHarness({ repository: true }, crashedRecordsNone), repositoryHarnessMillis,
  )
  it.effect("records none for an unclassified review whose final message holds valid findings", () =>
    withHarness({ repository: true }, unclassifiedRecordsNone), repositoryHarnessMillis,
  )
  it.effect("records none, and the review is Unclassified, when the findings block repeats an id", () =>
    withHarness({ repository: true }, repeatedIdRecordsNone), repositoryHarnessMillis,
  )
  it.effect("records none for an implement", () => withHarness({}, implementRecordsNone))
})
