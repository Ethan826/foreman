// Attempt classification (plan "Outcomes and usable attempts", AC6;
// design E6 and "Classification"): an attempt's outcome comes from the
// leader's exit and the decoded client events, never from the client's
// prose, because exit codes alone do not tell the outcomes apart. A
// reviewer's verdict comes from its decoded findings block (decision P8).
//
// Features may not import Format, so the decoded input is named here by
// the fields classification reads. The Format decoders' types have these
// shapes (format/claude.ts `ClaudeResult`, format/codex.ts `CodexEvent`),
// so Program passes their results as they are; the step-outcome test
// checks both that and that the Codex tags below equal the decoder's.
//
// Guess to confirm: no recorded evidence yet shows how either client
// reports a rate limit, a failed login or a denied permission in these
// events, so `RateLimited`, `AuthFailed` and `PermissionDenied` are never
// produced here; such an attempt is `Unclassified`, which is close-only
// like them (decision P11).
import { Array as Arr, Data, Match, Option, pipe, Result, Schema, String } from "effect"
import type {
  Findings,
  MalformedFindings,
  NoFindingsBlock,
} from "../domain/findings.ts"
import {
  ChangesRequested,
  Crashed,
  MaxTurns,
  Success,
  Unclassified,
  type StepOutcome,
} from "../domain/outcomes.ts"
import { type Role, Roles } from "../domain/roles.ts"

/** Claude's `result` subtype for a run that completed. */
const claudeSuccessSubtype = "success"

/** Claude's `result` subtype for a run stopped at its turn limit. */
const claudeMaxTurnsSubtype = "error_max_turns"

/**
 * The Codex event types that report a failed run: `turn.failed` and
 * `error`, as format/codex.ts's `CodexEventTypes` spells them.
 */
export const codexFailureTypes: ReadonlyArray<string> = ["turn.failed", "error"]

/** The Codex event type of a completed turn, `turn.completed`. */
export const codexTurnCompleted = "turn.completed"

/**
 * How the leader process ended: its exit code, or the signal that ended
 * it. Both are absent when the runtime could read neither.
 */
export interface AttemptExit {
  readonly code: Option.Option<number>
  readonly signal: Option.Option<string>
}

/** The fields of Claude's final `result` event that classification reads. */
export interface ClaudeResultFields {
  readonly subtype?: string
  readonly is_error?: boolean
}

/** The field of a Codex `--json` event that classification reads. */
export interface CodexEventFields {
  readonly type: string
}

/**
 * A Claude attempt's decoded stream-json output: its last `result`
 * event, absent when the stream held none.
 */
export class ClaudeDecoded extends Data.TaggedClass("ClaudeDecoded")<{
  readonly result: Option.Option<ClaudeResultFields>
}> {}

/** A Codex attempt's decoded `--json` events, in order. */
export class CodexDecoded extends Data.TaggedClass("CodexDecoded")<{
  readonly events: ReadonlyArray<CodexEventFields>
}> {}

/** The findings block decoded from a final message, or why it did not decode. */
export type DecodedFindings = Result.Result<
  Findings,
  NoFindingsBlock | MalformedFindings
>

/**
 * What Program decoded from one attempt: the client's events and, for a
 * reviewer, `decodeFindingsBlock` of its final message (absent when there
 * was no final message to read). Other roles' findings are not read.
 */
export interface DecodedAttempt {
  readonly client: ClaudeDecoded | CodexDecoded
  readonly findings: Option.Option<DecodedFindings>
}

/** The client's own verdict: it ran cleanly, or this outcome. */
type ClientVerdict = Option.Option<StepOutcome>

/** A clean run: classification goes on to the role's verdict. */
const clean: ClientVerdict = Option.none()

/** A run that ended with `outcome`, whatever the role. */
const endedWith = (outcome: StepOutcome): ClientVerdict => Option.some(outcome)

/**
 * Classifies one attempt of `role`. A leader ended by a signal is
 * `Crashed` with that signal (an empty signal name is `Unclassified`).
 * Otherwise the client's events decide: Claude's `error_max_turns` result
 * is `MaxTurns`; a run is clean only with exit code 0 and, for Claude, a
 * `success` result with `is_error` false, or for Codex, a completed turn
 * and no `turn.failed` or `error` event; anything else is `Unclassified`.
 * A clean run is `Success`, except for a reviewer, whose findings decide:
 * an empty list is `Success`, a non-empty one `ChangesRequested`, and an
 * absent or malformed block `Unclassified`.
 */
export const classifyAttempt = (
  role: Role,
  exit: AttemptExit,
  decoded: DecodedAttempt,
): StepOutcome =>
  Option.match(exit.signal, {
    onSome: crashedBy,
    onNone: () =>
      pipe(
        clientVerdict(decoded.client, exit),
        Option.getOrElse(() => roleVerdict(role, decoded.findings)),
      ),
  })

/**
 * Whether `outcome` lets the session go on after an attempt of `role`
 * (plan "Outcomes and usable attempts"): `Success` for an implementer or
 * corrector; `Success` or `ChangesRequested` for a reviewer. Every other
 * outcome allows only `close --abandoned` (decision P11).
 */
export const usable = (role: Role, outcome: StepOutcome): boolean =>
  Schema.is(Success)(outcome) ||
  (role === Roles.Reviewer && Schema.is(ChangesRequested)(outcome))

/** A signal ends the run as `Crashed`; a signal with no name is unclassified. */
const crashedBy = (signal: string): StepOutcome =>
  String.isEmpty(signal) ? new Unclassified() : new Crashed({ signal })

/** The client's verdict from its decoded events and the exit code. */
const clientVerdict = (
  client: ClaudeDecoded | CodexDecoded,
  exit: AttemptExit,
): ClientVerdict =>
  Match.value(client).pipe(
    Match.tag("ClaudeDecoded", (claude) => claudeVerdict(claude, exit)),
    Match.tag("CodexDecoded", (codex) => codexVerdict(codex, exit)),
    Match.exhaustive,
  )

/** Claude: max turns, then a clean success result with exit 0, else unclassified. */
const claudeVerdict = (claude: ClaudeDecoded, exit: AttemptExit): ClientVerdict =>
  Option.match(claude.result, {
    onNone: () => endedWith(new Unclassified()),
    onSome: (result) =>
      result.subtype === claudeMaxTurnsSubtype
        ? endedWith(new MaxTurns())
        : cleanIf(isClaudeSuccess(result) && exitedZero(exit)),
  })

/** Codex: a completed turn, no failure event and exit 0, else unclassified. */
const codexVerdict = (codex: CodexDecoded, exit: AttemptExit): ClientVerdict =>
  cleanIf(
    Arr.some(codex.events, isTurnCompleted) &&
      !Arr.some(codex.events, isCodexFailure) &&
      exitedZero(exit),
  )

/** Clean when `ranCleanly`, otherwise `Unclassified`. */
const cleanIf = (ranCleanly: boolean): ClientVerdict =>
  ranCleanly ? clean : endedWith(new Unclassified())

/** A `success` result that says it is not an error. */
const isClaudeSuccess = (result: ClaudeResultFields): boolean =>
  result.subtype === claudeSuccessSubtype && result.is_error === false

/** Whether the leader exited with code 0. */
const exitedZero = (exit: AttemptExit): boolean => Option.contains(exit.code, 0)

/** Whether a Codex event is a completed turn. */
const isTurnCompleted = (event: CodexEventFields): boolean =>
  event.type === codexTurnCompleted

/** Whether a Codex event reports a failure. */
const isCodexFailure = (event: CodexEventFields): boolean =>
  Arr.contains(codexFailureTypes, event.type)

/** A clean run's outcome: the reviewer's findings decide; others succeed. */
const roleVerdict = (
  role: Role,
  findings: Option.Option<DecodedFindings>,
): StepOutcome =>
  role === Roles.Reviewer ? reviewVerdict(findings) : new Success()

/** No findings is Success, some is ChangesRequested, none decoded is Unclassified. */
const reviewVerdict = (findings: Option.Option<DecodedFindings>): StepOutcome =>
  Option.match(findings, {
    onNone: () => new Unclassified(),
    onSome: Result.match({
      onFailure: () => new Unclassified(),
      onSuccess: verdictOfFindings,
    }),
  })

/** The verdict a decoded findings list gives. */
const verdictOfFindings = (findings: Findings): StepOutcome =>
  Arr.isReadonlyArrayEmpty(findings) ? new Success() : new ChangesRequested()
