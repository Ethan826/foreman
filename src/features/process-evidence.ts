// Advisory process evidence for `status` (plan "Process evidence"): what a
// decoded `ps` listing shows about the leader `Launched` recorded. A pid
// alone does not identify a process, since the system reuses ids, so the
// leader counts as listed only with its recorded start time. Members are
// the processes whose group is the recorded group. None of this proves
// anything: a listed group may be an unrelated one reusing the id, a
// descendant that left the group is not listed, and nothing listed does
// not establish cleanup. Tarlatan never signals.
import { Array as Arr, Option } from "effect"
import {
  GroupIdReused,
  LeaderIdReused,
  LeaderListed,
  LeaderNotListed,
  LeaderStartUnrecorded,
  NothingListed,
  ProcessesListed,
  type LeaderReading,
  type ProcessEvidence,
  type ProcessLeader,
  type ProcessRow,
} from "../domain/process.ts"

/**
 * The evidence a listing gives about `recorded`: {@link NothingListed}
 * when no row has the leader's pid or the recorded group, and otherwise
 * what the row with the leader's pid shows (see {@link LeaderReading})
 * with the recorded group's members in listing order.
 */
export const processEvidence = (recorded: ProcessLeader, rows: ReadonlyArray<ProcessRow>): ProcessEvidence => {
  const leaderRow = Arr.findFirst(rows, hasPid(recorded.pid))
  const members = Arr.filter(rows, inGroup(recorded.pgid))
  return Option.isNone(leaderRow) && Arr.isReadonlyArrayEmpty(members)
    ? new NothingListed()
    : new ProcessesListed({ leader: leaderReading(recorded, leaderRow), members })
}

/** What the row holding the leader's pid, if any, shows about the leader. */
const leaderReading = (recorded: ProcessLeader, leaderRow: Option.Option<ProcessRow>): LeaderReading =>
  Option.match(leaderRow, {
    onNone: () => new LeaderNotListed(),
    onSome: (row) =>
      Option.match(recorded.startedAt, {
        onNone: () => new LeaderStartUnrecorded({ startedAt: row.startedAt }),
        onSome: (startedAt) => comparedStart(recorded, row, startedAt),
      }),
  })

/**
 * The row with the leader's pid against the recorded start: the same start
 * is the leader; another start in the recorded group means the group id
 * was reused, and outside it the pid was.
 */
const comparedStart = (recorded: ProcessLeader, row: ProcessRow, startedAt: string): LeaderReading => {
  if (row.startedAt === startedAt) return new LeaderListed()
  return row.pgid === recorded.pgid
    ? new GroupIdReused({ startedAt: row.startedAt })
    : new LeaderIdReused({ startedAt: row.startedAt, pgid: row.pgid })
}

/** Whether a row is the process `pid`. */
const hasPid =
  (pid: number) =>
  (row: ProcessRow): boolean =>
    row.pid === pid

/** Whether a row belongs to process group `pgid`. */
const inGroup =
  (pgid: number) =>
  (row: ProcessRow): boolean =>
    row.pgid === pgid
