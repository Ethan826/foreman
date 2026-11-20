// What `status` runs over (plan "Commands and their prerequisites";
// review item B11): only reads. It has no lock, no ledger transaction and
// no capability that publishes or appends, so the type itself keeps
// status from writing. Production builds it in production-status.ts over
// stores opened read-only; a test passes its own.
import type { Effect, Option } from "effect"
import type { ProjectLog } from "../domain/events.ts"
import type { LedgerBusy, LedgerError, LedgerSnapshot } from "../domain/ledger.ts"
import type { StateFiles } from "../runtime/state-files.ts"
import type { SessionCapabilities, SessionSettings } from "./session-context.ts"

/** The read-only capabilities `status` runs over. */
export interface StatusCapabilities
  extends Pick<SessionCapabilities, "readProcesses" | "readClientVersion" | "checkWorktree" | "nowMono"> {
  /** The project log, read only. */
  readonly log: Pick<ProjectLog, "readFrom">
  /**
   * Every ledger row, read in one transaction that never takes the write
   * lock; none when there is no ledger file.
   */
  readonly ledgerRows: Effect.Effect<Option.Option<LedgerSnapshot>, LedgerError | LedgerBusy>
  /** The state files, read only. */
  readonly stateFiles: Pick<StateFiles, "read">
}

/** The capabilities and settings `status` runs over. */
export interface StatusContext {
  readonly capabilities: StatusCapabilities
  readonly settings: Pick<SessionSettings, "pins" | "estimates" | "admission">
}
