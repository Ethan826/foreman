// Why an assisted-session command stopped without finishing (plan
// "Commands and their prerequisites", "Write protocol"). Each is a typed
// failure the facade reports; each states what was written before it.
import { Schema } from "effect"
import { Client } from "../domain/clients.ts"
import { GrantId } from "../domain/ids.ts"
import { Refusal } from "../features/command-rules.ts"

/**
 * The command rules refused the command for every reason in `reasons`
 * (plan "Commands and their prerequisites"). Only the settle step's
 * ledger writes, if any, happened before it.
 */
export class CommandRefused extends Schema.TaggedError<CommandRefused>()("CommandRefused", {
  reasons: Schema.NonEmptyArray(Refusal),
}) {}

/**
 * A quota hold for `provider` is in place and `--waive` was not given
 * (write protocol, step 3): nothing beyond batch Q was recorded, and the
 * owner's consent was not consumed.
 */
export class QuotaHeld extends Schema.TaggedError<QuotaHeld>()("QuotaHeld", {
  provider: Client,
}) {}

/**
 * `--waive` for `provider` was refused because a waiver is already armed
 * for another provider (`waiveAccepted`); nothing beyond batch Q was
 * written.
 */
export class WaiverRefused extends Schema.TaggedError<WaiverRefused>()("WaiverRefused", {
  provider: Client,
}) {}

/**
 * Batch I could not be appended because the log moved (`PositionMoved`):
 * grant `grantId` was canceled as a lost race and nothing launched.
 */
export class LostRace extends Schema.TaggedError<LostRace>()("LostRace", {
  grantId: GrantId,
}) {}

/**
 * The session's recorded task file at `path` is missing or its hash no
 * longer matches the record; the session is close-only.
 */
export class TaskFileChanged extends Schema.TaggedError<TaskFileChanged>()("TaskFileChanged", {
  path: Schema.String,
}) {}

/**
 * The file at `path`, read for its text, is not valid UTF-8 (review
 * finding R04). Its bytes are never read with U+FFFD in place of the
 * invalid ones; nothing was recorded.
 */
export class FileNotUtf8 extends Schema.TaggedError<FileNotUtf8>()("FileNotUtf8", {
  path: Schema.String,
}) {}

/** The project log names no supervisor worktree: run `worktree create` first. */
export class NoWorktreeRecorded extends Schema.TaggedError<NoWorktreeRecorded>()(
  "NoWorktreeRecorded",
  {},
) {}

/**
 * A file the log records, at `path`, is missing or its hash no longer
 * matches the record; the session is close-only.
 */
export class RecordedFileChanged extends Schema.TaggedError<RecordedFileChanged>()("RecordedFileChanged", {
  path: Schema.String,
}) {}

/** The owner's findings file at `path` could not be read; nothing was recorded. */
export class FindingsFileUnreadable extends Schema.TaggedError<FindingsFileUnreadable>()("FindingsFileUnreadable", {
  path: Schema.String,
  reason: Schema.String,
}) {}

/**
 * `git diff-tree` for the review brief's changed paths exited non-zero
 * or printed what does not decode; `reason` says which. The snapshot's
 * objects may be staged; nothing was recorded.
 */
export class ChangedPathsUnread extends Schema.TaggedError<ChangedPathsUnread>()("ChangedPathsUnread", {
  reason: Schema.String,
}) {}
