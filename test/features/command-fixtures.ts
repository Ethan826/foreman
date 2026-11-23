// Shared states and checks for the command rule tests: one log per
// session state the matrix distinguishes, all checks met, and all
// checks failing.
import { Option, Schema } from "effect"
import { type Client, Clients } from "../../src/domain/clients.ts"
import type { ProjectEvent } from "../../src/domain/events.ts"
import { Approval, Failure, Quota } from "../../src/domain/holds.ts"
import { LedgerSeq, Revision, TrancheId } from "../../src/domain/ids.ts"
import { ChangesRequested, Crashed, Success, Unclassified } from "../../src/domain/outcomes.ts"
import { Roles } from "../../src/domain/roles.ts"
import { CloseKinds, type SessionCommand } from "../../src/domain/session.ts"
import {
  allowed,
  Allowed,
  type CommandChecks,
  LockNotHeld,
  NotAttested,
  Refused,
  SnapshotRefused,
  WorktreeCheckFailed,
  WrongState,
} from "../../src/features/command-rules.ts"
import { foldSession } from "../../src/features/session.ts"
import {
  approved,
  base,
  closed,
  endedByOwner,
  finished,
  intended,
  launched,
  opened,
  opId,
  rejected,
  treeA,
} from "./session-fixtures.ts"

export const quota = (provider: Client) =>
  new Quota({ provider, windows: [], heldMono: Option.none(), ledgerSeq: LedgerSeq.make(1) })
export const approval = new Approval({ tranche: TrancheId.make("t-1"), revision: Revision.make("a".repeat(40)) })
export const failure = new Failure({ opId: opId(1), outcome: new Unclassified() })

/** Every prerequisite met: HEAD is the session's base, the review handed out treeA and the snapshot is treeA. */
export const good: CommandChecks = {
  lockHeld: true,
  worktreeCheckPassed: true,
  head: Option.some(base),
  provider: Clients.Claude,
  pinMatches: true,
  holds: [],
  reportsIntact: true,
  attested: true,
  snapshot: Option.some({ tree: treeA, passedRawChecks: true }),
}
/** Every observed fact failing; a worktree check that failed read no HEAD. */
export const broken: CommandChecks = {
  lockHeld: true,
  worktreeCheckPassed: false,
  head: Option.none(),
  provider: Clients.Claude,
  pinMatches: false,
  holds: [approval, failure, quota(Clients.Claude)],
  reportsIntact: false,
  attested: false,
  snapshot: Option.none(),
}
export const codex: CommandChecks = { ...good, provider: Clients.Codex }

export const implementing = [opened(), intended(1)]
export const implemented = [opened(), intended(1), launched(1), finished(1, new Success())]
export const implementCrashed = [opened(), intended(1), finished(1, new Crashed({ signal: "SIGKILL" }))]
export const reviewing = [...implemented, approved(1, Roles.Reviewer), intended(2, Roles.Reviewer)]
export const changesAsked = [...reviewing, finished(2, new ChangesRequested())]
export const reviewClean = [...reviewing, finished(2, new Success())]
export const reviewUnclassified = [...reviewing, finished(2, new Unclassified())]
export const corrected = [...changesAsked, approved(2, Roles.Corrector), intended(3, Roles.Corrector), finished(3, new Success())]
export const twiceCorrected = [
  ...corrected,
  approved(3, Roles.Reviewer),
  intended(4, Roles.Reviewer),
  finished(4, new ChangesRequested()),
  approved(4, Roles.Corrector),
  intended(5, Roles.Corrector),
  finished(5, new Success()),
  approved(5, Roles.Reviewer),
  intended(6, Roles.Reviewer),
  finished(6, new ChangesRequested()),
]
export const interrupted = [...implementing, endedByOwner(1)]
export const wasRejected = [...implemented, rejected(1)]
export const wasClosed = [...implemented, closed(CloseKinds.Abandoned)]

export const states: Record<string, ReadonlyArray<ProjectEvent>> = {
  none: [],
  closed: wasClosed,
  "open, no attempt": [opened()],
  incomplete: implementing,
  "owner-ended": interrupted,
  "usable implement": implemented,
  "unusable implement": implementCrashed,
  "review with changes": changesAsked,
  "clean review": reviewClean,
  "unclassified review": reviewUnclassified,
  "usable correct": corrected,
  rejected: wasRejected,
}

export const decide = (command: SessionCommand, log: ReadonlyArray<ProjectEvent>, checks: CommandChecks = good) =>
  allowed(command, foldSession(log).state, checks)
export const ok = new Allowed({ waiverStep: false })
export const viaWaiver = new Allowed({ waiverStep: true })
/** The reasons `command` is refused, or none when it is allowed. */
export const refusals = (command: SessionCommand, log: ReadonlyArray<ProjectEvent>, checks: CommandChecks = good) => {
  const decision = decide(command, log, checks)
  return Schema.is(Refused)(decision) ? decision.reasons : []
}
export const wrongState = (log: ReadonlyArray<ProjectEvent>) => new WrongState({ state: foldSession(log).state })
export const lockNotHeld = new LockNotHeld()
export const worktreeFailed = new WorktreeCheckFailed()
export const notAttested = new NotAttested()
export const snapshotRefused = new SnapshotRefused()

/** The states, by name, in which `command` is allowed with every check met. */
export const allowedIn = (command: SessionCommand, checks: CommandChecks = good) =>
  Object.entries(states)
    .filter(([, log]) => Schema.is(Allowed)(decide(command, log, checks)))
    .map(([name]) => name)
