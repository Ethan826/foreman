// One assisted cycle end to end (plan "Slice A2", assisted-cycle): open,
// implement, review --attest, correct --attest, review, close --finished,
// with fake clients over a real disposable repository. The log is exactly
// the expected batches, including the quota hold and waiver every Codex
// review needs while the default policy lists no Codex window; each brief
// is built from recorded inputs only; and nothing launches without its
// command. The owner's findings file is the first review's draft, copied
// as it is; the second review, which finds nothing, drafts an empty list.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Effect, Option, Result, Schema } from "effect"
import { readFileSync } from "node:fs"
import {
  HandoffApproved,
  ReportRecorded,
  SessionClosed,
  SessionOpened,
  SnapshotTaken,
} from "../../src/domain/events.ts"
import type { Revision } from "../../src/domain/ids.ts"
import { ChangesRequested, Success } from "../../src/domain/outcomes.ts"
import { claudeEditingArgv, codexReviewArgv } from "../../src/domain/profiles.ts"
import { Roles } from "../../src/domain/roles.ts"
import { Attestations, CloseKinds } from "../../src/domain/session.ts"
import { correctBrief, implementBrief, reviewBrief, snapshotCoverage } from "../../src/format/brief.ts"
import { decodeFindingsBlock, renderFindingsDraft } from "../../src/format/findings.ts"
import { sha256Of } from "../../src/runtime/state-files.ts"
import { codexReviewClean } from "../fixtures/clients/codex-review-clean.ts"
import { findingsReviewMessage } from "../fixtures/clients/codex-review-findings.ts"
import { git } from "../runtime/git-repo.ts"
import {
  corrected,
  draftPathOf,
  eventsWhere,
  findingsFileOf,
  finished,
  implemented,
  reviewed,
} from "./handoff-steps.ts"
import { eventsOf, type Harness, logBatch, withHarness } from "./session-harness.ts"
import { opened } from "./session-steps.ts"

/** The log's events as tags, one array per batch the cycle wrote. */
const expectedBatches = [
  ["SessionOpened", "Approved"],
  ["Intended", "BriefRecorded"],
  ["Launched"],
  ["Finished", "ReportRecorded"],
  ["HoldCreated"],
  ["Waived"],
  ["SnapshotTaken", "HandoffApproved", "Intended", "BriefRecorded"],
  ["Launched"],
  ["Finished", "ReportRecorded"],
  ["ReviewChecked", "HandoffApproved", "Intended", "BriefRecorded"],
  ["Launched"],
  ["Finished", "ReportRecorded"],
  ["HoldCreated"],
  ["Waived"],
  ["SnapshotTaken", "HandoffApproved", "Intended", "BriefRecorded"],
  ["Launched"],
  ["Finished", "ReportRecorded"],
  ["ReviewChecked", "SessionClosed"],
]

/** The text of a recorded file. */
const text = (path: string) => readFileSync(path, "utf8")

/** The first value of a list, which the test requires. */
const first = <A>(values: ReadonlyArray<A>) => Effect.fromOption(Arr.head(values))

/** Runs the whole cycle and returns the launches' count after each command. */
const cycle = (harness: Harness) =>
  Effect.gen(function* () {
    const launched: Array<number> = []
    const after = () => launched.push(harness.client.launches.length)
    yield* opened(harness)
    after()
    expect((yield* implemented(harness)).outcome).toEqual(new Success())
    after()
    expect((yield* reviewed(harness)).outcome).toEqual(new ChangesRequested())
    after()
    expect((yield* corrected(harness)).outcome).toEqual(new Success())
    after()
    expect((yield* reviewed(harness, codexReviewClean)).outcome).toEqual(new Success())
    after()
    const closed = yield* finished(harness)
    after()
    return { launched, closed }
  })

const exactLog = (harness: Harness) =>
  Effect.gen(function* () {
    const { launched, closed } = yield* cycle(harness)
    expect(launched).toEqual([0, 1, 2, 3, 4, 4])
    expect(closed).toMatchObject({ how: CloseKinds.Finished, attests: Option.some(Attestations.QuiescenceAndInspection) })
    const events = yield* eventsOf(harness)
    expect(events).toMatchObject([{ _tag: "WorktreeCreated" }, ...expectedBatches.flat().map((tag) => ({ _tag: tag }))])
    const logged = harness.trace.filter((entry) => entry.kind === "log")
    expect(logged).toMatchObject(expectedBatches.slice(1).map((tags) => logBatch(...tags)))
    expect(Arr.filter(events, Schema.is(SessionClosed))).toHaveLength(1)
  })

/** The review argv for `tree`, the previous handoff and the launch's final-message file. */
const reviewArgv = (input: {
  readonly task: string
  readonly base: Revision
  readonly tree: Revision
  readonly handoff: string
  readonly lastMessageFile: string
}) =>
  codexReviewArgv({
    brief: reviewBrief({
      task: input.task,
      tree: input.tree,
      baseRevision: input.base,
      changedPaths: [{ status: "M", source: Option.none(), path: "greeting.txt" }],
      lastHandoff: input.handoff,
      coverage: snapshotCoverage,
    }),
    lastMessageFile: input.lastMessageFile,
  })

/** The final-message file a launch's argv names. */
const lastMessageOf = (harness: Harness, index: number) => harness.client.launches[index]?.argv.at(-2) ?? ""

const recordedBriefs = (harness: Harness) =>
  Effect.gen(function* () {
    yield* cycle(harness)
    const launches = harness.client.launches.map((launch) => launch.argv)
    const opening = yield* first(yield* eventsWhere(harness, Schema.is(SessionOpened)))
    const task = text(opening.taskPath)
    const [implementReport, firstReviewReport, correctReport] = yield* eventsWhere(harness, Schema.is(ReportRecorded))
    const [firstTree, secondTree] = (yield* eventsWhere(harness, Schema.is(SnapshotTaken))).map((taken) => taken.tree)
    const settingsFile = `${harness.dir}/claude-settings.json`
    const base = opening.baseRevision
    expect(text(implementReport?.handoffPath ?? "")).toBe("Wrote the greeting.")
    expect(text(correctReport?.handoffPath ?? "")).toBe("Named Ada.")
    expect(text(firstReviewReport?.handoffPath ?? "")).toBe(findingsReviewMessage)
    expect(firstReviewReport?.role).toBe(Roles.Reviewer)
    const findingsFile = text(findingsFileOf(harness))
    expect(launches).toEqual([
      claudeEditingArgv({ brief: implementBrief({ task }), settingsFile }),
      reviewArgv({ task, base, tree: firstTree ?? base, handoff: "Wrote the greeting.", lastMessageFile: lastMessageOf(harness, 1) }),
      claudeEditingArgv({
        brief: correctBrief({ task, findingsFile, priorHandoff: "Wrote the greeting.", tree: firstTree ?? base }),
        settingsFile,
      }),
      reviewArgv({ task, base, tree: secondTree ?? base, handoff: "Named Ada.", lastMessageFile: lastMessageOf(harness, 3) }),
    ])
  })

const snapshotTrees = (harness: Harness) =>
  Effect.gen(function* () {
    yield* cycle(harness)
    const [firstTaken, secondTaken] = yield* eventsWhere(harness, Schema.is(SnapshotTaken))
    const greetingIn = (tree: string) => git(harness.worktree.path, "cat-file", "blob", `${tree}:greeting.txt`)
    expect(yield* greetingIn(firstTaken?.tree ?? "missing")).toBe("Hello, world.")
    expect(yield* greetingIn(secondTaken?.tree ?? "missing")).toBe("Hello, Ada.")
  })

const handoffRecords = (harness: Harness) =>
  Effect.gen(function* () {
    yield* cycle(harness)
    const approvals = yield* eventsWhere(harness, Schema.is(HandoffApproved))
    expect(approvals.map((approval) => approval.toRole)).toEqual([Roles.Reviewer, Roles.Corrector, Roles.Reviewer])
    expect(approvals.map((approval) => approval.attests)).toEqual([
      Attestations.QuiescenceAndInspection,
      Attestations.QuiescenceAndInspection,
      Attestations.QuiescenceAndInspection,
    ])
    const findingsBytes = readFileSync(findingsFileOf(harness))
    expect(approvals.map((approval) => approval.findingsSha256)).toEqual([
      Option.none(),
      Option.some(sha256Of(findingsBytes)),
      Option.none(),
    ])
    const decoded = decodeFindingsBlock(findingsReviewMessage)
    expect(Result.map(decoded, renderFindingsDraft)).toEqual(Result.succeed(text(findingsFileOf(harness))))
    expect(text(yield* draftPathOf(harness))).toBe(renderFindingsDraft([]))
  })

describe("the assisted cycle with fake clients over a real repository", () => {
  it.effect("writes exactly the expected batches and launches once per launch command", () =>
    withHarness({ repository: true }, exactLog))

  it.effect("gives each client a brief built only from recorded inputs", () =>
    withHarness({ repository: true }, recordedBriefs))

  it.effect("reviews the snapshot trees of the implementer's and the corrector's edits", () =>
    withHarness({ repository: true }, snapshotTrees))

  it.effect("records each handoff's role, attestation and findings hash, and drafts the findings", () =>
    withHarness({ repository: true }, handoffRecords))
})
