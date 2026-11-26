// The commands the CLI reads (plans "Slice A1" and "Slice A2", facade),
// each mapped to one Program call in cli.ts. They carry the owner's words
// as given and decide nothing; `--attest` in particular is passed on, and
// Program refuses a handoff without it.
import { Schema } from "effect"
import { GrantId, OpId, RulingId, TrancheId } from "../domain/ids.ts"
import { CloseKind } from "../domain/session.ts"

/** `worktree create`: create and record the supervisor worktree. */
export class CreateWorktree extends Schema.TaggedClass<CreateWorktree>()("CreateWorktree", {}) {}
/** `session open --tranche <id> --task <path>`. */
export class OpenSession extends Schema.TaggedClass<OpenSession>()("OpenSession", {
  tranche: TrancheId,
  taskFile: Schema.String,
}) {}
/** `implement [--waive]`. */
export class RunImplement extends Schema.TaggedClass<RunImplement>()("RunImplement", { waive: Schema.Boolean }) {}
/** `review [--waive] [--attest]`. */
export class RunReview extends Schema.TaggedClass<RunReview>()("RunReview", {
  waive: Schema.Boolean,
  attest: Schema.Boolean,
}) {}
/** `correct --findings <file> [--waive] [--attest]`. */
export class RunCorrect extends Schema.TaggedClass<RunCorrect>()("RunCorrect", {
  findingsFile: Schema.String,
  waive: Schema.Boolean,
  attest: Schema.Boolean,
}) {}
/** `reject [--note <text>]`. */
export class RejectHandoff extends Schema.TaggedClass<RejectHandoff>()("RejectHandoff", { note: Schema.String }) {}
/** `status`. */
export class ShowStatus extends Schema.TaggedClass<ShowStatus>()("ShowStatus", {}) {}
/** `step-ended <opId> --grant <grantId>`. */
export class EndStep extends Schema.TaggedClass<EndStep>()("EndStep", { opId: OpId, grantId: GrantId }) {}
/** `session close --abandoned|--interrupted [--note <text>]`. */
export class CloseSession extends Schema.TaggedClass<CloseSession>()("CloseSession", {
  how: CloseKind,
  note: Schema.String,
}) {}
/** `session close --finished [--attest] [--note <text>]`. */
export class FinishSession extends Schema.TaggedClass<FinishSession>()("FinishSession", {
  note: Schema.String,
  attest: Schema.Boolean,
}) {}

/** `ruling add --text <t> [--supersedes <id>]`: the text as given, non-blank. */
export class RecordRuling extends Schema.TaggedClass<RecordRuling>()("RecordRuling", {
  text: Schema.String,
  supersedes: Schema.Option(RulingId),
}) {}
/** `overrule <findingId> --note <reason>`: the note as given, non-blank. */
export class OverruleFinding extends Schema.TaggedClass<OverruleFinding>()("OverruleFinding", {
  findingId: Schema.String,
  note: Schema.String,
}) {}

/** Any command the CLI reads. */
export type CliCommand =
  | RecordRuling
  | OverruleFinding
  | CreateWorktree
  | OpenSession
  | RunImplement
  | RunReview
  | RunCorrect
  | RejectHandoff
  | ShowStatus
  | EndStep
  | CloseSession
  | FinishSession
