// The owner's `ledger settle` (design "Grant lifecycle"; plan Task B4):
// settles a project's grants without its `run`. It takes the project lock
// at once or is refused, reads the project's log, and in one ledger
// transaction cancels orphans and charges finished steps at their
// estimate. Steps still in flight are returned with their recorded
// process group for the owner. The command is given no process or git
// capability: it signals nothing and runs no git command.
import { Array as Arr, Effect } from "effect"
import { LogPosition, type ProjectLog } from "../domain/events.ts"
import type { ProjectId } from "../domain/ids.ts"
import type { LedgerStore } from "../domain/ledger.ts"
import { type InFlight, ownerSettle } from "../features/settle.ts"
import { tryLock } from "../runtime/project-lock.ts"
import { settleRowOf } from "./admission.ts"

/**
 * Runs `ledger settle` for `project` under the lock at `lockPath` and
 * returns the steps left in flight. Fails with `LockHeld`, writing
 * nothing, while another holder (a `run` or a command) has the lock.
 */
export const ledgerSettle = (
  lockPath: string,
  log: ProjectLog,
  store: LedgerStore,
  project: ProjectId,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* tryLock(lockPath)
      const events = Arr.map(yield* log.readFrom(LogPosition.make(0)), (logged) => logged.event)
      return yield* store.transact((tx) =>
        Effect.gen(function* () {
          const settlement = ownerSettle(events, yield* tx.read, project)
          yield* tx.append(Arr.map(settlement.actions, settleRowOf))
          return settlement.inFlight
        }),
      )
    }),
  ) satisfies Effect.Effect<ReadonlyArray<InFlight>, unknown>
