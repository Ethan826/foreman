// A client's process as foreman records and observes it (plan
// "Process evidence", advisory only): the leader's identity read once
// right after spawn, one row of a `ps` listing, how the leader ended, the
// advisory evidence that `status` shows, and the typed failures of
// starting a client and reading the listing. Foreman never signals a
// client, so nothing here describes stopping one.
import { type Result, Schema } from "effect"

/**
 * A process id as `ps` prints it, or the id of a group that a process
 * leads: a positive integer.
 */
export const ProcessId = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
/** A process id or a leader's group id; see {@link ProcessId}. */
export type ProcessId = typeof ProcessId.Type

/**
 * The process group of a listed process as `ps` prints it: a non-negative
 * integer. It is 0 for a process the kernel started outside any group:
 * procps on Linux lists kernel threads such as `kthreadd` in group 0, and
 * in some containers and VMs pid 1 as well. No client foreman starts is in
 * group 0, since each leads its own group, so such a row is never a member.
 */
export const ProcessGroupId = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
/** A listed process's group id; see {@link ProcessGroupId}. */
export type ProcessGroupId = typeof ProcessGroupId.Type

/**
 * A process's start time as `ps -o lstart` prints it, kept as text, such
 * as `Wed Nov 19 10:23:45 2026`. Two readings of one process give the
 * same text, so equal text with an equal pid identifies the process; the
 * resolution is one second. Format checks the layout.
 */
export const StartTime = Schema.String.check(Schema.isNonEmpty())
/** A process's start time text; see {@link StartTime}. */
export type StartTime = typeof StartTime.Type

/**
 * One row of `ps -A -o pid,pgid,lstart,command`: the process id, its
 * process group id, its start time and its command line as `ps` prints it.
 */
export const ProcessRow = Schema.Struct({
  pid: ProcessId,
  pgid: ProcessGroupId,
  startedAt: StartTime,
  command: Schema.String,
})
/** One row of a process listing; see {@link ProcessRow}. */
export type ProcessRow = typeof ProcessRow.Type

/**
 * A client's leader as `Launched` records it: its pid, the process group
 * it leads (equal to its pid, since it is started as the leader of a new
 * group) and its start time, read once right after spawn. `startedAt` is
 * none when that reading failed or did not list the leader.
 */
export const ProcessLeader = Schema.Struct({
  pid: ProcessId,
  pgid: ProcessId,
  startedAt: Schema.OptionFromOptionalKey(StartTime),
})
/** A recorded client leader; see {@link ProcessLeader}. */
export type ProcessLeader = typeof ProcessLeader.Type

/**
 * How a client's leader ended: its exit code, or the name of the signal
 * that ended it (such as `SIGTERM`). Exactly one is present for a leader
 * that ran; foreman sends no signal, so a signal came from elsewhere.
 */
export const ClientExit = Schema.Struct({
  code: Schema.Option(Schema.Int),
  signal: Schema.Option(Schema.String),
})
/** How a client's leader ended; see {@link ClientExit}. */
export type ClientExit = typeof ClientExit.Type

/** A process with the recorded leader's pid is listed with the recorded start time. */
export class LeaderListed extends Schema.TaggedClass<LeaderListed>()("LeaderListed", {}) {}

/**
 * A process with the recorded leader's pid, in the recorded group, is
 * listed with a different start time: the group id may now belong to an
 * unrelated group, and so may the listed members.
 */
export class GroupIdReused extends Schema.TaggedClass<GroupIdReused>()("GroupIdReused", {
  startedAt: StartTime,
}) {}

/**
 * A process with the recorded leader's pid, outside the recorded group, is
 * listed with a different start time: the pid may now belong to an
 * unrelated process.
 */
export class LeaderIdReused extends Schema.TaggedClass<LeaderIdReused>()("LeaderIdReused", {
  startedAt: StartTime,
  pgid: ProcessGroupId,
}) {}

/**
 * A process with the recorded leader's pid is listed, but no start time
 * was recorded, so whether it is the leader cannot be told.
 */
export class LeaderStartUnrecorded extends Schema.TaggedClass<LeaderStartUnrecorded>()(
  "LeaderStartUnrecorded",
  { startedAt: StartTime },
) {}

/** No process with the recorded leader's pid is listed. */
export class LeaderNotListed extends Schema.TaggedClass<LeaderNotListed>()("LeaderNotListed", {}) {}

/** What the listing shows about the recorded leader's pid. */
export const LeaderReading = Schema.Union([
  LeaderListed,
  GroupIdReused,
  LeaderIdReused,
  LeaderStartUnrecorded,
  LeaderNotListed,
])
/** What the listing shows about the leader; see {@link LeaderReading}. */
export type LeaderReading = typeof LeaderReading.Type

/**
 * The listing shows something of the recorded process: what it shows
 * about the leader's pid, and the processes whose group is the recorded
 * group, in listing order. A descendant that left the group is not among
 * the members.
 */
export class ProcessesListed extends Schema.TaggedClass<ProcessesListed>()("ProcessesListed", {
  leader: LeaderReading,
  members: Schema.Array(ProcessRow),
}) {}

/**
 * The listing shows neither the leader's pid nor any process in the
 * recorded group. This is not evidence of cleanup: a descendant that left
 * the group is not listed here.
 */
export class NothingListed extends Schema.TaggedClass<NothingListed>()("NothingListed", {}) {}

/**
 * Advisory process evidence for `status` (plan "Process evidence"). It is
 * evidence, not proof, and never a claim that the client's processes are
 * gone.
 */
export const ProcessEvidence = Schema.Union([ProcessesListed, NothingListed])
/** Advisory process evidence; see {@link ProcessEvidence}. */
export type ProcessEvidence = typeof ProcessEvidence.Type

/**
 * A line of a client's stdout whose bytes are not UTF-8 (review finding
 * R04): `byteLength` bytes without the line's end. Its text is never
 * guessed, so classification counts it malformed; the raw file keeps
 * the bytes.
 */
export class UndecodableLine extends Schema.TaggedClass<UndecodableLine>()("UndecodableLine", {
  byteLength: Schema.Int,
}) {}

/** One line of a client's stdout: its text when its bytes are UTF-8, or an {@link UndecodableLine}. */
export type StdoutLine = Result.Result<string, UndecodableLine>

/**
 * A client could not be started: the executable or directory was not
 * found, or the start failed otherwise. Also the failure of a version
 * read that did not run or was ended by a signal.
 */
export class ClientStartFailed extends Schema.TaggedError<ClientStartFailed>()("ClientStartFailed", {
  argv: Schema.Array(Schema.String),
  reason: Schema.String,
}) {}

/** The process listing could not be read: `ps` did not start, exited non-zero or was signaled. */
export class ProcessReadFailed extends Schema.TaggedError<ProcessReadFailed>()("ProcessReadFailed", {
  reason: Schema.String,
}) {}

/**
 * A process listing did not have the expected shape: a missing final
 * newline, a wrong header, or a row that does not decode. `reason` names
 * the offending line.
 */
export class ProcessListingUndecodable extends Schema.TaggedError<ProcessListingUndecodable>()(
  "ProcessListingUndecodable",
  { reason: Schema.String },
) {}
