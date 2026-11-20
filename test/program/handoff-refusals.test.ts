// The handoff commands' refusals (plan "Slice A2", handoff-refusals;
// "Commands and their prerequisites"; "Quiescence, inspection and
// snapshots"). Each refusal appends nothing. A command refused for its
// prerequisites runs no git command and writes no git object: staging
// happens only after the attestation and every other prerequisite pass.
import { describe, expect, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { writeFileSync } from "node:fs"
import { Clients } from "../../src/domain/clients.ts"
import { Finished, Intended, ReportRecorded } from "../../src/domain/events.ts"
import { GrantId, OpId } from "../../src/domain/ids.ts"
import { Success } from "../../src/domain/outcomes.ts"
import { Roles } from "../../src/domain/roles.ts"
import { CloseKinds, SessionId, Sha256 } from "../../src/domain/session.ts"
import { correct } from "../../src/program/correct.ts"
import { closeFinished } from "../../src/program/handoff.ts"
import { closeSession } from "../../src/program/session.ts"
import { claudeCrash } from "../fixtures/clients/claude-crash.ts"
import { claudeLingeringChild, lingeringFile } from "../fixtures/clients/claude-lingering-child.ts"
import { codexReviewClean } from "../fixtures/clients/codex-review-clean.ts"
import { codexReviewMalformed } from "../fixtures/clients/codex-review-malformed.ts"
import { git } from "../runtime/git-repo.ts"
import {
  attestedClose,
  attestedCorrect,
  attestedReview,
  unattestedCorrect,
  unattestedReview,
} from "./handoff-commands.ts"
import {
  afterClean,
  afterFindings,
  afterImplement,
  corrected,
  implemented,
  rejected,
  reviewed,
  sessionIdOf,
  stagesNothing,
} from "./handoff-steps.ts"
import { type Harness, head, withHarness } from "./session-harness.ts"
import { append, opened, refusedFor, tranche } from "./session-steps.ts"

const noAttestReview = (harness: Harness) =>
  Effect.gen(function* () {
    yield* afterImplement(harness)
    yield* stagesNothing(harness, unattestedReview(harness))
    yield* refusedFor(harness, unattestedReview(harness), ["NotAttested"])
    expect(harness.gitCalls).toEqual([])
    expect(harness.client.launches).toHaveLength(1)
  })

const noAttestCorrect = (harness: Harness) =>
  Effect.gen(function* () {
    yield* afterFindings(harness)
    yield* stagesNothing(harness, unattestedCorrect(harness))
    yield* refusedFor(harness, unattestedCorrect(harness), ["NotAttested"])
    expect(harness.client.launches).toHaveLength(2)
  })

const noAttestClose = (harness: Harness) =>
  Effect.gen(function* () {
    yield* afterClean(harness)
    const unattested = closeFinished(harness.context, { note: "", attest: false })
    yield* stagesNothing(harness, unattested)
    yield* refusedFor(harness, unattested, ["NotAttested"])
  })

const rawChecksFail = (harness: Harness) =>
  Effect.gen(function* () {
    yield* afterImplement(harness)
    yield* git(harness.worktree.path, "config", "core.autocrlf", "true")
    writeFileSync(`${harness.worktree.path}/crlf.txt`, "one\r\ntwo\r\n")
    yield* refusedFor(harness, attestedReview(harness), ["SnapshotRefused"])
    expect(harness.client.launches).toHaveLength(1)
  })

const writeDuringReview = (harness: Harness) =>
  Effect.gen(function* () {
    yield* afterFindings(harness)
    writeFileSync(`${harness.worktree.path}/greeting.txt`, "Changed while reviewed.\n")
    yield* refusedFor(harness, attestedCorrect(harness), ["TreeChanged"])
    expect(harness.client.launches).toHaveLength(2)
  })

const writeBeforeClose = (harness: Harness) =>
  Effect.gen(function* () {
    yield* afterClean(harness)
    writeFileSync(`${harness.worktree.path}/extra.txt`, "Written after the review.\n")
    yield* refusedFor(harness, attestedClose(harness), ["TreeChanged"])
  })

const reportFromAnotherSession = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    const opId = OpId.make("op-x")
    const grantId = GrantId.make("grant-x")
    const sha = Sha256.make("0".repeat(64))
    yield* append(harness, [
      new Intended({
        opId,
        tranche,
        step: { role: Roles.Implementer, round: 0 },
        baseRevision: head,
        grantId,
        client: Clients.Claude,
        waiverId: Option.none(),
      }),
    ])
    yield* append(harness, [
      new Finished({ opId, outcome: new Success(), endedAt: 1 }),
      new ReportRecorded({
        sessionId: SessionId.make("another-session"),
        opId,
        role: Roles.Implementer,
        rawPath: `${harness.dir}/raw`,
        rawSha256: sha,
        handoffPath: `${harness.dir}/handoff`,
        handoffSha256: sha,
      }),
    ])
    yield* refusedFor(harness, attestedReview(harness), ["ReportsNotIntact"])
    expect(yield* sessionIdOf(harness)).not.toBe("another-session")
  })

const reportBytesChanged = (harness: Harness) =>
  Effect.gen(function* () {
    yield* afterImplement(harness)
    const handoff = harness.trace.flatMap((entry) => (entry.kind === "publish" ? entry.items : [])).find((path) =>
      String(path).endsWith(".handoff.md"),
    )
    writeFileSync(String(handoff), "Edited after the fact.")
    yield* refusedFor(harness, attestedReview(harness), ["ReportsNotIntact"])
  })

const reviewTwice = (harness: Harness) =>
  Effect.gen(function* () {
    yield* afterFindings(harness)
    yield* refusedFor(harness, attestedReview(harness), ["WrongState"])
  })

const reviewAfterClean = (harness: Harness) =>
  Effect.gen(function* () {
    yield* afterClean(harness)
    yield* refusedFor(harness, attestedReview(harness), ["WrongState"])
  })

const correctBeforeReview = (harness: Harness) =>
  Effect.gen(function* () {
    yield* afterImplement(harness)
    writeFileSync(`${harness.dir}/owner-findings.md`, "# Findings\n")
    const early = correct(harness.context, { findingsFile: `${harness.dir}/owner-findings.md`, waive: false, attest: true })
    yield* stagesNothing(harness, early)
    yield* refusedFor(harness, early, ["WrongState", "SnapshotRefused"])
  })

const thirdCorrection = (harness: Harness) =>
  Effect.gen(function* () {
    yield* afterFindings(harness)
    yield* corrected(harness)
    yield* reviewed(harness)
    yield* corrected(harness)
    yield* reviewed(harness)
    yield* refusedFor(harness, attestedCorrect(harness), ["CorrectionsExhausted"])
    expect(harness.client.launches).toHaveLength(6)
  })

const afterReject = (harness: Harness) =>
  Effect.gen(function* () {
    yield* afterImplement(harness)
    yield* rejected(harness)
    yield* refusedFor(harness, attestedReview(harness), ["WrongState"])
    yield* refusedFor(harness, rejected(harness), ["WrongState"])
    yield* refusedFor(harness, attestedClose(harness), ["WrongState", "SnapshotRefused"])
    yield* refusedFor(harness, closeSession(harness.context, { how: CloseKinds.Interrupted, note: "" }), ["WrongState"])
    yield* closeSession(harness.context, { how: CloseKinds.Abandoned, note: "" })
    expect(harness.client.launches).toHaveLength(1)
  })

const unusableImplement = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    yield* implemented(harness, claudeCrash)
    yield* refusedFor(harness, attestedReview(harness), ["WrongState"])
    yield* refusedFor(harness, rejected(harness), ["WrongState"])
    yield* closeSession(harness.context, { how: CloseKinds.Abandoned, note: "" })
  })

const unusableReview = (harness: Harness) =>
  Effect.gen(function* () {
    yield* afterImplement(harness)
    yield* reviewed(harness, codexReviewMalformed)
    writeFileSync(`${harness.dir}/owner-findings.md`, "# Findings\n")
    const correction = correct(harness.context, { findingsFile: `${harness.dir}/owner-findings.md`, waive: false, attest: true })
    yield* refusedFor(harness, correction, ["WrongState"])
    yield* refusedFor(harness, attestedClose(harness), ["WrongState"])
    yield* refusedFor(harness, attestedReview(harness), ["WrongState"])
    yield* refusedFor(harness, rejected(harness), ["WrongState"])
    yield* closeSession(harness.context, { how: CloseKinds.Abandoned, note: "" })
    expect(harness.client.launches).toHaveLength(2)
  })

const lingeringChild = (harness: Harness) =>
  Effect.gen(function* () {
    const lingering = claudeLingeringChild()
    yield* opened(harness)
    yield* implemented(harness, lingering.script)
    yield* stagesNothing(harness, unattestedReview(harness))
    yield* refusedFor(harness, unattestedReview(harness), ["NotAttested"])
    yield* lingering.ended
    expect(yield* git(harness.worktree.path, "status", "--porcelain")).toContain(lingeringFile)
    harness.client.queue.push(codexReviewClean)
    yield* attestedReview(harness)
    expect(harness.client.launches).toHaveLength(2)
  })

describe("handoff refusals", () => {
  it.effect("review without --attest is refused before any git command or object", () =>
    withHarness({ repository: true }, noAttestReview))
  it.effect("correct without --attest is refused before any git command or object", () =>
    withHarness({ repository: true }, noAttestCorrect))
  it.effect("close --finished without --attest is refused before any git command or object", () =>
    withHarness({ repository: true }, noAttestClose))
  it.effect("a candidate that fails the raw checks is refused", () => withHarness({ repository: true }, rawChecksFail))
  it.effect("a write during review makes correct refuse", () => withHarness({ repository: true }, writeDuringReview))
  it.effect("a write after a clean review makes close --finished refuse", () =>
    withHarness({ repository: true }, writeBeforeClose))
  it.effect("a report recorded for another session is not this session's report", () =>
    withHarness({ repository: true }, reportFromAnotherSession))
  it.effect("a report whose bytes changed refuses the review", () => withHarness({ repository: true }, reportBytesChanged))
  it.effect("review twice is refused", () => withHarness({ repository: true }, reviewTwice))
  it.effect("review after a clean review is refused", () => withHarness({ repository: true }, reviewAfterClean))
  it.effect("correct before a review is refused before any git command", () =>
    withHarness({ repository: true }, correctBeforeReview))
  it.effect("a third correction is refused", () => withHarness({ repository: true }, thirdCorrection))
  it.effect("after reject only close --abandoned remains", () => withHarness({ repository: true }, afterReject))
  it.effect("an unusable implementation allows only close", () => withHarness({ repository: true }, unusableImplement))
  it.effect("an unusable review allows only close", () => withHarness({ repository: true }, unusableReview))
  it.effect("a leader that exits while its child writes does not enable review without --attest", () =>
    withHarness({ repository: true }, lingeringChild))
})
