// `ruling add`, `overrule` and the re-review through the Program (v0.2.0
// design, "Commands and events", "Closing after overrules", "Briefs";
// dogfood-6b), over the handoff harness with a real worktree: ids count
// every ruling, the overrule's ruling quotes the finding and the note,
// every brief kind lists the rulings with their marks, the recorded
// brief hash covers them, `overrule` appends its two events in one
// batch, a re-review's batch I and brief (after an implement and after a
// correction), and an overrule that stands after its ruling is
// superseded.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Effect, Option, Schema } from "effect"
import { readFileSync, writeFileSync } from "node:fs"
import {
  BriefRecorded,
  FindingOverruled,
  HandoffApproved,
  Intended,
  type ProjectEvent,
  ReviewChecked,
  RulingAdded,
  SessionClosed,
  SnapshotTaken,
} from "../../src/domain/events.ts"
import { RulingId } from "../../src/domain/ids.ts"
import { Success } from "../../src/domain/outcomes.ts"
import { Roles } from "../../src/domain/roles.ts"
import { CloseKinds } from "../../src/domain/session.ts"
import { addRuling, overrule } from "../../src/program/rulings.ts"
import { claudeSuccess } from "../fixtures/clients/claude-success.ts"
import { codexReviewClean } from "../fixtures/clients/codex-review-clean.ts"
import { codexReviewTwoFindings } from "../fixtures/clients/codex-review-two-findings.ts"
import { attestedReview } from "./handoff-commands.ts"
import { afterImplement, corrected, eventsWhere, finished, implemented, reviewed, sessionIdOf } from "./handoff-steps.ts"
import { eventsOf, type Harness, logBatch, repositoryHarnessMillis, withHarness } from "./session-harness.ts"
import { opened, refusedFor } from "./session-steps.ts"

const id = (n: number) => RulingId.make(`R${String(n)}`)

/** Runs `ruling add --text <text>`, superseding ruling `supersedes` if given. */
const ruling = (harness: Harness, text: string, supersedes: Option.Option<number> = Option.none()) =>
  addRuling(harness.context, { text, supersedes: Option.map(supersedes, id) })

/** Runs `overrule <findingId> --note <note>`. */
const overruled = (harness: Harness, findingId: string, note: string) =>
  overrule(harness.context, { findingId, note })

/** The text of every brief recorded so far, in log order. */
const briefTexts = (harness: Harness) =>
  Effect.map(eventsWhere(harness, Schema.is(BriefRecorded)), Arr.map((brief) => readFileSync(brief.briefPath, "utf8")))

/** The text of the brief recorded for attempt `opId`. */
const briefOf = (harness: Harness, opId: string) =>
  Effect.flatMap(eventsWhere(harness, Schema.is(BriefRecorded)), (briefs) =>
    Effect.fromOption(
      Option.map(
        Arr.findFirst(briefs, (brief) => brief.opId === opId),
        (brief) => readFileSync(brief.briefPath, "utf8"),
      ),
    ),
  )

/** The last event `guard` accepts. */
const lastWhere = <A extends ProjectEvent>(harness: Harness, guard: (event: ProjectEvent) => event is A) =>
  Effect.flatMap(eventsWhere(harness, guard), (events) => Effect.fromOption(Arr.last(events)))

/** The summaries of the two-findings review's F2 and F1. */
const summaryF2 = "The greeting lacks a name."
const summaryF1 = "The task asks for a period at the end."

const idsCountEveryRuling = (harness: Harness) =>
  Effect.gen(function* () {
    yield* afterImplement(harness)
    const review = yield* reviewed(harness, codexReviewTwoFindings)
    const note = "A name is not asked for.\nSee the task."
    const first = yield* ruling(harness, "Keep the greeting short.")
    harness.trace.length = 0
    const over = yield* overruled(harness, "F2", note)
    const appends = Arr.filter(harness.trace, (entry) => entry.kind === "log")
    expect(appends).toMatchObject([logBatch("RulingAdded", "FindingOverruled")])
    const third = yield* ruling(harness, "Use a period.")
    expect([first.rulingId, over.rulingId, third.rulingId]).toEqual([id(1), id(2), id(3)])
    const sessionId = yield* sessionIdOf(harness)
    expect(over).toEqual(
      new FindingOverruled({ sessionId, reviewOpId: review.opId, findingId: "F2", rulingId: id(2), note }),
    )
    const events = yield* eventsOf(harness)
    expect(Arr.takeRight(events, 4)).toEqual([
      first,
      new RulingAdded({
        sessionId,
        rulingId: id(2),
        text: `Finding F2 of review ${review.opId} is overruled: ${note} (the finding: ${summaryF2})`,
        supersedes: Option.none(),
      }),
      over,
      third,
    ])
  })

const everyBriefListsRulings = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    yield* ruling(harness, "Greet the world.")
    yield* implemented(harness)
    yield* ruling(harness, "Greet Ada.", Option.some(1))
    yield* reviewed(harness)
    yield* corrected(harness)
    const [implement, review, correct] = yield* briefTexts(harness)
    expect(implement).toContain("## Owner rulings\n\nR1: Greet the world.\n\n## What to do")
    const both = "## Owner rulings\n\nR1 (superseded by R2): Greet the world.\n\nR2 (supersedes R1): Greet Ada.\n\n"
    expect(review).toContain(`${both}A ruling settles its point.`)
    expect(correct).toContain(`${both}## Findings to address`)
  })

/** The `briefSha256` of the implement brief, in a fresh session, after `ruling add` when `withRuling`. */
const implementSha = (withRuling: boolean) =>
  withHarness({}, (harness) =>
    Effect.gen(function* () {
      yield* opened(harness)
      if (withRuling) yield* ruling(harness, "Greet the world.")
      yield* implemented(harness, claudeSuccess)
      expect(harness.gitCalls).toEqual([])
      return (yield* lastWhere(harness, Schema.is(BriefRecorded))).briefSha256
    }),
  )

const hashCoversRulings = Effect.gen(function* () {
  const before = yield* implementSha(false)
  expect(yield* implementSha(false)).toBe(before)
  expect(yield* implementSha(true)).not.toBe(before)
})

const reReviewRuns = (harness: Harness) =>
  Effect.gen(function* () {
    yield* afterImplement(harness)
    const first = yield* reviewed(harness, codexReviewTwoFindings)
    const reviewedTree = (yield* lastWhere(harness, Schema.is(SnapshotTaken))).tree
    yield* overruled(harness, "F1", "The period is optional.")
    harness.trace.length = 0
    const second = yield* reviewed(harness, codexReviewClean)
    expect(second.outcome).toEqual(new Success())
    const batchI = Arr.findFirst(harness.trace, (entry) => entry.kind === "log" && Arr.some(entry.items, Schema.is(Intended)))
    expect(Option.getOrUndefined(batchI)).toMatchObject(
      logBatch("SnapshotTaken", "ReviewChecked", "HandoffApproved", "Intended", "BriefRecorded"),
    )
    const sessionId = yield* sessionIdOf(harness)
    expect(yield* lastWhere(harness, Schema.is(SnapshotTaken))).toEqual(
      new SnapshotTaken({ sessionId, forOpId: first.opId, tree: reviewedTree }),
    )
    expect(yield* lastWhere(harness, Schema.is(ReviewChecked))).toEqual(
      new ReviewChecked({ sessionId, reviewOpId: first.opId, reviewedTree, currentTree: reviewedTree }),
    )
    expect(yield* lastWhere(harness, Schema.is(HandoffApproved))).toMatchObject({
      fromOpId: first.opId,
      toRole: Roles.Reviewer,
      tree: reviewedTree,
    })
    expect((yield* lastWhere(harness, Schema.is(Intended))).step).toEqual({ role: Roles.Reviewer, round: 0 })
    const brief = yield* briefOf(harness, second.opId)
    expect(brief).toContain("## Handoff from the previous step\n\nWrote the greeting.\n")
    expect(brief).not.toContain("Two problems.")
    expect(brief).toContain(
      `R1: Finding F1 of review ${first.opId} is overruled: The period is optional. (the finding: ${summaryF1})`,
    )
    expect((yield* finished(harness)).how).toBe(CloseKinds.Finished)
  })

const reReviewAfterCorrection = (harness: Harness) =>
  Effect.gen(function* () {
    yield* afterImplement(harness)
    yield* reviewed(harness)
    yield* corrected(harness)
    const first = yield* reviewed(harness, codexReviewTwoFindings)
    yield* overruled(harness, "F1", "The period is optional.")
    const second = yield* reviewed(harness, codexReviewClean)
    expect(second.outcome).toEqual(new Success())
    expect(yield* lastWhere(harness, Schema.is(HandoffApproved))).toMatchObject({
      fromOpId: first.opId,
      toRole: Roles.Reviewer,
    })
    expect((yield* lastWhere(harness, Schema.is(Intended))).step).toEqual({ role: Roles.Reviewer, round: 1 })
    const brief = yield* briefOf(harness, second.opId)
    expect(brief).toContain("## Handoff from the previous step\n\nNamed Ada.\n")
    expect(brief).not.toContain("Wrote the greeting.")
    expect(brief).not.toContain("Two problems.")
  })

const reReviewRefusedOnChangedTree = (harness: Harness) =>
  Effect.gen(function* () {
    yield* afterImplement(harness)
    yield* reviewed(harness, codexReviewTwoFindings)
    yield* refusedFor(harness, attestedReview(harness), ["WrongState"])
    yield* overruled(harness, "F1", "The period is optional.")
    writeFileSync(`${harness.worktree.path}/greeting.txt`, "Changed after the review.\n")
    yield* refusedFor(harness, attestedReview(harness), ["TreeChanged"])
    expect(harness.client.launches).toHaveLength(2)
  })

const overruleStandsAfterSupersession = (harness: Harness) =>
  Effect.gen(function* () {
    yield* afterImplement(harness)
    yield* reviewed(harness, codexReviewTwoFindings)
    yield* overruled(harness, "F1", "The period is optional.")
    yield* overruled(harness, "F2", "A name is not asked for.")
    yield* ruling(harness, "F1 is overruled because the task allows either.", Option.some(1))
    yield* refusedFor(harness, overruled(harness, "F1", "Again."), ["FindingOverruledAlready"])
    expect((yield* finished(harness)).how).toBe(CloseKinds.Finished)
    expect(Arr.length(yield* eventsWhere(harness, Schema.is(SessionClosed)))).toBe(1)
  })

const supersessionShownInReReview = (harness: Harness) =>
  Effect.gen(function* () {
    yield* afterImplement(harness)
    const first = yield* reviewed(harness, codexReviewTwoFindings)
    yield* overruled(harness, "F1", "The period is optional.")
    yield* ruling(harness, "The period is required after all.", Option.some(1))
    yield* refusedFor(harness, overruled(harness, "F1", "Again."), ["FindingOverruledAlready"])
    const second = yield* reviewed(harness, codexReviewClean)
    const brief = yield* briefOf(harness, second.opId)
    expect(brief).toContain(
      `R1 (superseded by R2): Finding F1 of review ${first.opId} is overruled: The period is optional. ` +
        `(the finding: ${summaryF1})\n\nR2 (supersedes R1): The period is required after all.\n\n`,
    )
  })

describe("ruling add and overrule through the Program", () => {
  it.effect("number rulings R1, R2, R3 across ruling add, overrule, ruling add, and quote the finding exactly", () =>
    withHarness({ repository: true }, idsCountEveryRuling), repositoryHarnessMillis,
  )
  it.effect("every brief kind lists every ruling, the superseded one marked in every later brief", () =>
    withHarness({ repository: true }, everyBriefListsRulings), repositoryHarnessMillis,
  )
  it.effect("the recorded brief hash differs once a ruling is added", () => hashCoversRulings)
  it.effect("superseding an overrule's ruling leaves the finding overruled, and close --finished allowed", () =>
    withHarness({ repository: true }, overruleStandsAfterSupersession), repositoryHarnessMillis,
  )
})

describe("review again after an overrule, through the Program", () => {
  it.effect("runs on the reviewed tree with batch I [SnapshotTaken, ReviewChecked, HandoffApproved, Intended] and the last edit's handoff", () =>
    withHarness({ repository: true }, reReviewRuns), repositoryHarnessMillis,
  )
  it.effect("after a correction, keeps round 1 and takes the corrector's handoff", () =>
    withHarness({ repository: true }, reReviewAfterCorrection), repositoryHarnessMillis,
  )
  it.effect("is refused before an overrule, and with TreeChanged on a changed tree after one", () =>
    withHarness({ repository: true }, reReviewRefusedOnChangedTree), repositoryHarnessMillis,
  )
  it.effect("shows the superseded overrule ruling in the re-review's brief", () =>
    withHarness({ repository: true }, supersessionShownInReReview), repositoryHarnessMillis,
  )
})
