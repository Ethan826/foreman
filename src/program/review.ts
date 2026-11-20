// `review [--waive] --attest` (plan "Slice A2"): Codex reviews the
// attested candidate after a usable implement or correct. The launch
// protocol is attempt.ts; this file is the reviewer's plan. Its rules
// are checked with the snapshot presumed to pass before anything is
// staged; then the attribute check runs again and the snapshot is taken
// and checked. Batch I is [`SnapshotTaken`, `HandoffApproved`,
// `Intended`]. The brief holds the recorded task, the tree, the base
// revision, the changed paths from `git diff-tree` through the pinned
// runner, the previous step's recorded handoff and the coverage
// statement. Codex's final message is the handoff; its findings block
// decides the outcome, and when it decodes it is published as the
// session's findings draft for the owner to edit.
import { type Cause, Effect, Option, Result, String } from "effect"
import { MalformedFindings } from "../domain/findings.ts"
import { HandoffApproved, SnapshotTaken } from "../domain/events.ts"
import type { Revision } from "../domain/ids.ts"
import { codexReviewArgv } from "../domain/profiles.ts"
import { defaultRoleClients, Roles } from "../domain/roles.ts"
import { Attestations, Review } from "../domain/session.ts"
import type { OpenSession } from "../domain/session-state.ts"
import { reviewBrief, snapshotCoverage } from "../format/brief.ts"
import { decodeFindingsBlock, renderFindingsDraft } from "../format/findings.ts"
import { decodeNameStatus } from "../format/name-status.ts"
import { type LaunchPlan, type PrepareInput, runAttempt } from "./attempt.ts"
import type { AttemptFiles } from "./attempt-run.ts"
import { codexDecoded, utf8Bytes } from "./client-output.ts"
import { withBriefsIntact } from "./brief-files.ts"
import { awaitedHandoff, handoffFacts, presumedPassing, handoffTextOf, takeSnapshot } from "./handoff-facts.ts"
import { recordedTask } from "./implement.ts"
import type { HandoffGitFailure, SessionContext } from "./session-context.ts"
import { ChangedPathsUnread, type FileNotUtf8, type RecordedFileChanged, type TaskFileChanged } from "./session-errors.ts"

/** The owner's options for `review`. */
export interface ReviewOptions {
  /** `--waive`: the owner consents to waive a Codex quota hold for this launch. */
  readonly waive: boolean
  /** `--attest`: quiescence and inspection since the last attempt (decision P12). */
  readonly attest: boolean
}

/** Why a review stopped in its own steps, before or around the launch. */
export type ReviewFailure =
  | HandoffGitFailure
  | TaskFileChanged
  | RecordedFileChanged
  | FileNotUtf8
  | ChangedPathsUnread
  | Cause.NoSuchElementError

/** The exit code of a git command that succeeded. */
const successExit = 0

/** Runs `review` (see attempt.ts for the protocol and its failures). */
export const review = (context: SessionContext, options: ReviewOptions) =>
  runAttempt(context, reviewPlan(context, options))

/**
 * The session's findings draft, which each review that decodes its
 * findings publishes: `<stateDir>/<sessionId>.findings-draft.md`.
 */
export const findingsDraftPath = (stateDir: string, session: OpenSession) =>
  `${stateDir}/${session.opened.sessionId}.findings-draft.md`

/** The reviewer's launch plan. */
const reviewPlan = (context: SessionContext, options: ReviewOptions): LaunchPlan<ReviewFailure> => ({
  command: new Review(),
  role: Roles.Reviewer,
  provider: defaultRoleClients[Roles.Reviewer],
  waive: options.waive,
  observe: (fold) =>
    withBriefsIntact(context, fold.state)(
      handoffFacts(context, fold.state, options.attest, presumedPassing(fold.state)),
    ),
  snapshot: (session) => Effect.map(takeSnapshot(context, session), Option.some),
  prepare: (input) => prepared(context, input),
  argv: (brief, files) => codexReviewArgv({ brief, lastMessageFile: files.lastMessage }),
  handoff: (files) => lastMessage(context, files),
  decode: (lines, handoff) => ({ client: codexDecoded(lines), findings: findingsOfMessage(handoff) }),
  afterHandoff: (session, handoff) => publishDraft(context, session, handoff),
})

/** The brief, round and batch I's consent events, from recorded inputs and the snapshot. */
const prepared = (context: SessionContext, input: PrepareInput) =>
  Effect.gen(function* () {
    const { session } = input
    const tree = yield* Effect.map(Effect.fromOption(input.snapshot), (snapshot) => snapshot.tree)
    const awaited = yield* Effect.fromOption(awaitedHandoff(input.state))
    const base = session.opened.baseRevision
    const brief = reviewBrief({
      task: yield* recordedTask(context, session),
      tree,
      baseRevision: base,
      changedPaths: yield* changedPaths(context, session, tree),
      lastHandoff: yield* handoffTextOf(context, session, awaited.opId),
      coverage: snapshotCoverage,
    })
    const { sessionId } = session.opened
    const consent = [
      new SnapshotTaken({ sessionId, forOpId: awaited.opId, tree }),
      new HandoffApproved({
        sessionId,
        fromOpId: awaited.opId,
        toRole: Roles.Reviewer,
        tree,
        findingsSha256: Option.none(),
        attests: Attestations.QuiescenceAndInspection,
      }),
    ]
    return { brief, round: session.corrections, consent }
  })

/** The paths that differ between the base revision and `tree`, decoded. */
const changedPaths = (context: SessionContext, session: OpenSession, tree: Revision) =>
  Effect.gen(function* () {
    const git = context.capabilities.handoffGit(session.opened.worktree)
    const output = yield* git.changedPaths(session.opened.baseRevision, tree)
    if (output.exitCode !== successExit) return yield* new ChangedPathsUnread({ reason: output.stderr })
    return yield* Effect.mapError(
      Effect.fromResult(decodeNameStatus(output.stdout)),
      (issue) => new ChangedPathsUnread({ reason: issue.reason }),
    )
  })

/**
 * Codex's final message, from the file it was told to write; empty only
 * when no file is there (review item M02). A file present but unreadable
 * fails the command before batch F.
 */
const lastMessage = (context: SessionContext, files: AttemptFiles) =>
  Effect.map(context.capabilities.stateFiles.readIfPresent(files.lastMessage), Option.getOrElse(() => new Uint8Array()))

/** The findings block of a final message; none when there was no message to read. */
const findingsOf = (handoff: string) =>
  String.isEmpty(handoff) ? Option.none() : Option.some(decodeFindingsBlock(handoff))

/**
 * The findings block of a final message that may not be UTF-8: a final
 * message whose bytes are not UTF-8 has malformed findings, which makes
 * the review `Unclassified` (review finding R04).
 */
const findingsOfMessage = (handoff: Option.Option<string>) =>
  Option.match(handoff, { onNone: notUtf8Findings, onSome: findingsOf })

/** The findings of a final message that is not UTF-8. */
const notUtf8Findings = () => Option.some(Result.fail(new MalformedFindings({ reason: notUtf8Reason })))

/** Why the findings of a final message that is not UTF-8 are malformed. */
const notUtf8Reason = "the final message is not valid UTF-8"

/** Publishes the findings draft when the final message's findings decode. */
const publishDraft = (context: SessionContext, session: OpenSession, handoff: string) =>
  Option.match(Option.flatMap(findingsOf(handoff), Result.getSuccess), {
    onNone: () => Effect.void,
    onSome: (findings) =>
      Effect.flatMap(utf8Bytes(renderFindingsDraft(findings)), (bytes) =>
        Effect.asVoid(context.capabilities.stateFiles.publish(findingsDraftPath(context.settings.stateDir, session), bytes)),
      ),
  })
