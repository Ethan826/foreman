// The assisted session (plan "Assisted cycle", slices A1 and A2): its
// identifiers, the ways a session closes, the owner's attestation, the
// recorded worktree identity and the commands the owner gives. A session
// is one bounded task driven by owner commands; every handoff waits for
// one. The session's states are in session-state.ts, its log events in
// session-events.ts.
import { Record, Schema } from "effect"
import { GrantId, OpId, RulingId } from "./ids.ts"

// A short slug, as in ids.ts: letters, digits, dot, underscore and
// hyphen, 1 to 64 characters, the first a letter or digit.
const slug = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
)

/** An absolute path: text starting with `/`, so never empty. */
const absolutePath = Schema.String.check(Schema.isStartingWith("/"))

/** Identifies an assisted session. A slug of 1 to 64 characters. */
export const SessionId = slug.pipe(Schema.brand("SessionId"))
/** A session id; see {@link SessionId}. */
export type SessionId = typeof SessionId.Type

/**
 * Identifies one owner-approved handoff between attempts. A slug of 1 to
 * 64 characters; the plan's events do not carry it yet, so it names a
 * handoff's files at most.
 */
export const HandoffId = slug.pipe(Schema.brand("HandoffId"))
/** A handoff id; see {@link HandoffId}. */
export type HandoffId = typeof HandoffId.Type

/** A SHA-256 digest in lowercase hexadecimal: 64 digits. */
export const Sha256 = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{64}$/),
).pipe(Schema.brand("Sha256"))
/** A SHA-256 digest; see {@link Sha256}. */
export type Sha256 = typeof Sha256.Type

/**
 * How a session closes (plan "Close rules"): `finished` after a usable
 * review with no changes requested, attested, on the reviewed tree;
 * `abandoned` with no incomplete attempt; `interrupted` once the owner
 * attested the end of every incomplete attempt; `unconverged` (v0.2.0
 * design, "The correction limit", the design's `notConverged`) when a
 * review that asked for changes awaits its handoff, not every one of its
 * recorded findings is overruled, and the session's corrections reached
 * its limit.
 */
export const CloseKinds = {
  Finished: "finished",
  Abandoned: "abandoned",
  Interrupted: "interrupted",
  Unconverged: "unconverged",
} as const
/** Schema for a close kind, one of {@link CloseKinds}. */
export const CloseKind = Schema.Literals(Record.values(CloseKinds))
/** A close kind, one of the values of {@link CloseKinds}. */
export type CloseKind = typeof CloseKind.Type

/**
 * What the owner's `--attest` asserts (plan "Quiescence, inspection and
 * snapshots", decision P12): one value covering both that no process of
 * a preceding attempt still runs and that the protected inputs were
 * inspected since the last attempt.
 */
export const Attestations = {
  QuiescenceAndInspection: "quiescence-and-inspection",
} as const
/** Schema for an attestation, one of {@link Attestations}. */
export const Attestation = Schema.Literals(Record.values(Attestations))
/** An attestation, one of the values of {@link Attestations}. */
export type Attestation = typeof Attestation.Type

/**
 * The git identity recorded for the supervisor worktree (plan B11d): its
 * top level, its own git directory and the repository's common
 * directory, each an absolute path (decoding refuses any other). The fields match Runtime's
 * `RecordedGitIdentity` and `WorktreeCreated`, so a record passes as it
 * is; Domain defines its own schema because it imports no Runtime.
 */
export const RecordedGitIdentity = Schema.Struct({
  path: absolutePath,
  gitDir: absolutePath,
  commonDir: absolutePath,
})
/** A recorded git identity; see {@link RecordedGitIdentity}. */
export type RecordedGitIdentity = typeof RecordedGitIdentity.Type

/** `status`: shows the session; never takes the lock, never writes. */
export class Status extends Schema.TaggedClass<Status>()("Status", {}) {}
/** `session open`: opens a session for a task. */
export class SessionOpen extends Schema.TaggedClass<SessionOpen>()(
  "SessionOpen",
  {},
) {}
/** `implement`: launches the implementer, the session's first attempt. */
export class Implement extends Schema.TaggedClass<Implement>()(
  "Implement",
  {},
) {}
/** `review`: launches the reviewer on the attested current candidate. */
export class Review extends Schema.TaggedClass<Review>()("Review", {}) {}
/** `correct`: launches the corrector with the owner's findings file. */
export class Correct extends Schema.TaggedClass<Correct>()("Correct", {}) {}
/** `reject`: refuses the awaiting handoff; only `ruling add`, `rounds grant` and `close --abandoned` remain. */
export class Reject extends Schema.TaggedClass<Reject>()("Reject", {}) {}
/**
 * `step-ended`: the owner attests that attempt `opId`, reserved by grant
 * `grantId`, has ended (plan "Settlement for owner-ended steps").
 */
export class StepEnded extends Schema.TaggedClass<StepEnded>()("StepEnded", {
  opId: OpId,
  grantId: GrantId,
}) {}
/** `session close --<how>`: closes the open session. */
export class SessionClose extends Schema.TaggedClass<SessionClose>()(
  "SessionClose",
  { how: CloseKind },
) {}

/**
 * `ruling add --text <t> [--supersedes <id>]`: records an owner ruling
 * that every later brief lists (v0.2.0 design, "Commands and events").
 * `supersedes` names the earlier ruling it replaces, if any; the rules
 * read only that, so the text is not part of the command.
 */
export class AddRuling extends Schema.TaggedClass<AddRuling>()("AddRuling", {
  supersedes: Schema.Option(RulingId),
}) {}
/**
 * `overrule <findingId> --note <reason>`: overrules finding `findingId`
 * of the review awaiting its handoff, which also records a ruling
 * (v0.2.0 design, "Closing after overrules"). The note is not part of
 * the command; the rules read only the finding.
 */
export class Overrule extends Schema.TaggedClass<Overrule>()("Overrule", {
  findingId: Schema.String.check(Schema.isNonEmpty()),
}) {}

/**
 * A number of correction rounds the owner grants: a safe integer
 * (`Schema.Int` refuses any other) of at least 1 (v0.2.0 design, "The
 * correction limit").
 */
export const RoundCount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))

/**
 * The owner's reason for a grant of rounds: text with at least one
 * character that is not whitespace, so never empty or blank.
 */
export const GrantNote = Schema.String.check(Schema.isPattern(/\S/))

/**
 * `rounds grant <n> --note <reason>`: raises the open session's
 * correction limit by `count` (v0.2.0 design, "The correction limit"). The
 * note is not part of the command; the rules read only the state.
 */
export class GrantRounds extends Schema.TaggedClass<GrantRounds>()("GrantRounds", {
  count: RoundCount,
}) {}

/** Schema for any owner command of the assisted session. */
export const SessionCommand = Schema.Union([
  Status,
  SessionOpen,
  Implement,
  Review,
  Correct,
  Reject,
  StepEnded,
  SessionClose,
  AddRuling,
  Overrule,
  GrantRounds,
])
/** Any owner command; see {@link SessionCommand}. */
export type SessionCommand = typeof SessionCommand.Type
