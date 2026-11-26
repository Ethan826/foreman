// `correct --findings <file> [--waive] --attest` (plan "Slice A2"):
// Claude corrects the reviewed tree after a review that asked for
// changes, at most twice per session (decision P9). The launch protocol
// is attempt.ts; this file is the corrector's plan. Its rules are checked
// with the snapshot presumed equal to the reviewed tree before anything
// is staged; then the attribute check runs again, the snapshot is taken
// and the rules check that it equals the reviewed tree, so a stale review
// refuses and appends nothing. Batch I is [`ReviewChecked`,
// `HandoffApproved`, `Intended`]. Only the owner's findings file reaches
// the corrector: it is published in the state directory and its SHA-256
// is recorded in `HandoffApproved`. The prior handoff in the brief is the
// last implementer's or corrector's, not the reviewer's, whose final
// message holds the reviewer's own findings. Claude's editing profile is
// published for the session's worktree before admission (batch review B03)
// with the configured check commands, which the brief names too (dogfood-3b).
import { type Cause, Effect, Option } from "effect"
import { HandoffApproved, ReviewChecked } from "../domain/events.ts"
import { claudeEditingArgv } from "../domain/profiles.ts"
import { defaultRoleClients, Roles } from "../domain/roles.ts"
import { Attestations, Correct } from "../domain/session.ts"
import type { OpenSession } from "../domain/session-state.ts"
import { correctBrief } from "../format/brief.ts"
import { type LaunchPlan, noFinishedExtras, type PrepareInput, runAttempt } from "./attempt.ts"
import { claudeDecoded, claudeHandoff, strictText } from "./client-output.ts"
import { withBriefsIntact } from "./brief-files.ts"
import { awaitedHandoff, handoffFacts, presumedOnReviewedTree, handoffTextOf, lastEdit, takeSnapshot } from "./handoff-facts.ts"
import { recordedTask } from "./implement.ts"
import type { CheckCommandRefused, ProfilePathUnsafe } from "../format/claude-settings.ts"
import type { StateFileFailed } from "../runtime/state-files.ts"
import { claudeSettingsPath } from "./claude-profile.ts"
import type { HandoffGitFailure, SessionContext } from "./session-context.ts"
import { type FileNotUtf8, FindingsFileUnreadable, type RecordedFileChanged, type TaskFileChanged } from "./session-errors.ts"

/** The owner's options for `correct`. */
export interface CorrectOptions {
  /** `--findings <file>`: the owner's findings, the only ones the corrector sees. */
  readonly findingsFile: string
  /** `--waive`: the owner consents to waive a Claude quota hold for this launch. */
  readonly waive: boolean
  /** `--attest`: quiescence and inspection since the last attempt (decision P12). */
  readonly attest: boolean
}

/** Why a correction stopped in its own steps, before or around the launch. */
export type CorrectFailure =
  | HandoffGitFailure
  | TaskFileChanged
  | RecordedFileChanged
  | FileNotUtf8
  | FindingsFileUnreadable
  | StateFileFailed
  | ProfilePathUnsafe
  | CheckCommandRefused
  | Cause.NoSuchElementError

/** Runs `correct` (see attempt.ts for the protocol and its failures). */
export const correct = (context: SessionContext, options: CorrectOptions) =>
  runAttempt(context, correctPlan(context, options))

/** The corrector's launch plan. */
const correctPlan = (context: SessionContext, options: CorrectOptions): LaunchPlan<CorrectFailure> => ({
  command: new Correct(),
  role: Roles.Corrector,
  provider: defaultRoleClients[Roles.Corrector],
  waive: options.waive,
  observe: (fold) =>
    withBriefsIntact(context, fold.state)(
      handoffFacts(context, fold.state, options.attest, presumedOnReviewedTree(fold.state)),
    ),
  snapshot: (session) => Effect.map(takeSnapshot(context, session), Option.some),
  prepare: (input) => prepared(context, options, input),
  argv: (brief) => claudeEditingArgv({ brief, settingsFile: claudeSettingsPath(context.settings.stateDir) }),
  handoff: (_files, lines) => claudeHandoff(lines),
  decode: (lines) => ({ client: claudeDecoded(lines), findings: Option.none() }),
  afterHandoff: () => Effect.void,
  finishedExtras: noFinishedExtras,
})

/** The brief, round and batch I's consent events, from recorded inputs, the findings file and the snapshot. */
const prepared = (context: SessionContext, options: CorrectOptions, input: PrepareInput) =>
  Effect.gen(function* () {
    const { session } = input
    const tree = yield* Effect.map(Effect.fromOption(input.snapshot), (snapshot) => snapshot.tree)
    const review = yield* Effect.fromOption(awaitedHandoff(input.state))
    const reviewedTree = yield* Effect.fromOption(session.reviewedTree)
    const findings = yield* ownerFindings(context, session, review.opId, options.findingsFile)
    const edit = yield* Effect.fromOption(lastEdit(session))
    const { checkCommands } = context.settings
    yield* context.capabilities.publishClaudeProfile(session.opened.worktree, checkCommands)
    const brief = correctBrief({
      task: yield* recordedTask(context, session),
      findingsFile: findings.text,
      priorHandoff: yield* handoffTextOf(context, session, edit.intent.opId),
      tree,
      checkCommands,
    })
    const { sessionId } = session.opened
    const consent = [
      new ReviewChecked({ sessionId, reviewOpId: review.opId, reviewedTree, currentTree: tree }),
      new HandoffApproved({
        sessionId,
        fromOpId: review.opId,
        toRole: Roles.Corrector,
        tree,
        findingsSha256: Option.some(findings.sha256),
        attests: Attestations.QuiescenceAndInspection,
      }),
    ]
    return { brief, round: session.corrections + 1, consent }
  })

/** Why a findings file whose bytes are not UTF-8 is unreadable (review finding R04). */
const findingsNotUtf8 = "not valid UTF-8"

/** Why a findings file that is not there is unreadable. */
const findingsMissing = "no file at this path"

/**
 * The owner's findings file, read and published in the state directory
 * as `<sessionId>.<reviewOpId>.findings.md`: its text and its SHA-256.
 * A missing file or bytes that are not UTF-8 are `FindingsFileUnreadable`,
 * a refusal; a read that fails for any other reason keeps its own
 * `StateFileFailed`, a failure (review item R01).
 */
const ownerFindings = (context: SessionContext, session: OpenSession, reviewOpId: string, path: string) =>
  Effect.gen(function* () {
    const { stateFiles } = context.capabilities
    const read = yield* stateFiles.readIfPresent(path)
    const bytes = yield* Effect.fromOption(read, () => new FindingsFileUnreadable({ path, reason: findingsMissing }))
    const copy = `${context.settings.stateDir}/${session.opened.sessionId}.${reviewOpId}.findings.md`
    const sha256 = yield* stateFiles.publish(copy, bytes)
    const text = yield* Effect.mapError(
      strictText(path, bytes),
      () => new FindingsFileUnreadable({ path, reason: findingsNotUtf8 }),
    )
    return { text, sha256 }
  })
