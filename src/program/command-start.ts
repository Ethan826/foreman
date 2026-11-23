// What every assisted-session command reads before it decides (plan
// "Commands and their prerequisites", "Write protocol" step 1): the whole
// log with its position, the recorded supervisor worktree and its check,
// the version pin, the holds in place, and the rules' verdict. Program
// only reads here; Features decides.
import { Array as Arr, Clock, Effect, Option, Result, Schema } from "effect"
import { type Client, Clients } from "../domain/clients.ts"
import {
  type LoggedEvent,
  LogPosition,
  type ProjectEvent,
  type ProjectLog,
  WorktreeCreated,
} from "../domain/events.ts"
import { Roles } from "../domain/roles.ts"
import type { Revision } from "../domain/ids.ts"
import type { SessionCommand } from "../domain/session.ts"
import type { SessionState } from "../domain/session-state.ts"
import { allowed, Allowed, type CommandChecks } from "../features/command-rules.ts"
import { holdsInPlace, pinMatches } from "../features/launch-facts.ts"
import type { LedgerSnapshot } from "../domain/ledger.ts"
import { openSessionOf } from "../features/session-phases.ts"
import { foldSession } from "../features/session.ts"
import type {
  SessionCapabilities,
  SessionContext,
  SessionSettings,
  UnreadAtHead,
  WorktreeCheckUnrun,
  WorktreeUnready,
} from "./session-context.ts"
import { CommandRefused } from "./session-errors.ts"

/** The log as one command read it: every event and the position after the last. */
export interface LogRead {
  readonly position: LogPosition
  readonly logged: ReadonlyArray<LoggedEvent>
  readonly events: ReadonlyArray<ProjectEvent>
}

/** Reads the whole log; needs only the log's read. */
export const readLog = (log: Pick<ProjectLog, "readFrom">) =>
  Effect.map(
    log.readFrom(LogPosition.make(0)),
    (logged): LogRead => ({
      position: Option.getOrElse(
        Option.map(Arr.last(logged), (entry) => entry.position),
        () => LogPosition.make(0),
      ),
      logged,
      events: Arr.map(logged, (entry) => entry.event),
    }),
  )

/** The latest `WorktreeCreated` in the log: the recorded supervisor worktree. */
export const recordedWorktree = (events: ReadonlyArray<ProjectEvent>): Option.Option<WorktreeCreated> =>
  Arr.findLast(events, Schema.is(WorktreeCreated))

/**
 * The startup worktree check on the recorded worktree: its HEAD when it
 * passes, or the reason it judged the worktree unready. The attribute
 * check judges the open session's base, or the worktree's HEAD when no
 * session is open, never the base the worktree was created at (batch
 * review B07). The HEAD is only read here: whether it moved from the
 * session's base is the command rules' `HeadMoved` decision (owner
 * ruling of 2026-11-23). A judgment never fails, so a command that does not need
 * the check still runs; a check that could not run fails with its own
 * `WorktreeCheckUnrun`, never turned into a judgment (review item R01);
 * an `UnreadAtHead` fails with its `AttributeSourcesUnread`.
 */
export const worktreeReading = (
  context: { readonly capabilities: Pick<SessionCapabilities, "checkWorktree"> },
  events: ReadonlyArray<ProjectEvent>,
): Effect.Effect<WorktreeReading, WorktreeCheckUnrun> =>
  Effect.catchTag(headedReading(context, events), "UnreadAtHead", (failure) => Effect.fail(failure.unread))

/**
 * {@link worktreeReading}, with an `UnreadAtHead` kept: `status` reads
 * its HEAD beside the unread attribute source (owner finding F3, dogfood-3a).
 */
export const headedReading = (
  context: { readonly capabilities: Pick<SessionCapabilities, "checkWorktree"> },
  events: ReadonlyArray<ProjectEvent>,
): Effect.Effect<WorktreeReading, WorktreeCheckUnrun | UnreadAtHead> =>
  Option.match(recordedWorktree(events), {
    onNone: () => Effect.succeed(unreadReading("no supervisor worktree is recorded; run `worktree create`")),
    onSome: (recorded) =>
      Effect.catchTag(
        Effect.map(context.capabilities.checkWorktree(recorded, sessionBase(events)), passedReading),
        "WorktreeUnready",
        unreadyReading,
      ),
  })

/**
 * The startup check as a command reads it: its verdict, the HEAD when it
 * passed or the reason it judged the worktree unready, and the HEAD it
 * read, which an unready worktree whose attribute sources alone were
 * refused keeps too (owner finding F2, dogfood-3a round 1).
 */
export interface WorktreeReading {
  readonly verdict: Result.Result<Revision, string>
  readonly head: Option.Option<Revision>
}

/** A check that passed, read as its HEAD. */
const passedReading = (head: Revision): WorktreeReading => ({ verdict: Result.succeed(head), head: Option.some(head) })

/** A worktree judged unready before any HEAD was read, with `reason`. */
const unreadReading = (reason: string): WorktreeReading => ({ verdict: Result.fail(reason), head: Option.none() })

/** A check that judged the worktree unready, read as its reason and the HEAD it read, if any. */
const unreadyReading = (unready: WorktreeUnready) =>
  Effect.succeed<WorktreeReading>({ verdict: Result.fail(unready.reason), head: unready.head })

/** The open session's base revision, if a session is open. */
const sessionBase = (events: ReadonlyArray<ProjectEvent>) =>
  Option.map(openSessionOf(foldSession(events).state), (session) => session.opened.baseRevision)

/**
 * Whether the installed `client` matches its pin. A client that cannot
 * be started does not match.
 */
export const pinReading = (
  context: {
    readonly capabilities: Pick<SessionCapabilities, "readClientVersion">
    readonly settings: Pick<SessionSettings, "pins">
  },
  client: Client,
) =>
  Effect.match(context.capabilities.readClientVersion(client), {
    onFailure: () => false,
    onSuccess: (output) => pinMatches(context.settings.pins[client], output),
  })

/** What {@link holdsFrom} reads besides the log and the ledger: the clocks and the admission settings. */
export interface HoldsContext {
  readonly capabilities: Pick<SessionCapabilities, "nowMono">
  readonly settings: Pick<SessionSettings, "admission" | "estimates">
}

/** The holds in place now: the log's holds less quota holds that readings release. */
export const holdsNow = (context: SessionContext, read: LogRead) =>
  Effect.flatMap(
    context.capabilities.ledger.transact((tx) => tx.read),
    (snapshot) => holdsFrom(context, read, snapshot),
  )

/** The holds in place now, from the log as read and a ledger snapshot read by the caller. */
export const holdsFrom = (context: HoldsContext, read: LogRead, snapshot: LedgerSnapshot) =>
  Effect.gen(function* () {
    return holdsInPlace(read.logged, snapshot, {
      now: yield* Clock.currentTimeMillis,
      nowMono: yield* context.capabilities.nowMono,
      context: context.settings.admission,
      estimate: estimateOf(context.settings),
    })
  })

/**
 * The checks of a command that launches nothing: the lock is held, the
 * worktree check passed or not, these holds are in place, and no HEAD
 * was read. `close --finished` adds its own HEAD read (handoff.ts).
 */
export const ownerChecks = (worktreePassed: boolean, holds: CommandChecks["holds"]): CommandChecks => ({
  lockHeld: true,
  worktreeCheckPassed: worktreePassed,
  head: Option.none(),
  provider: Clients.Claude,
  pinMatches: true,
  holds,
  reportsIntact: true,
  attested: false,
  snapshot: Option.none(),
})

/** Fails with {@link CommandRefused} unless the rules allow `command`. */
export const requireAllowed = (command: SessionCommand, state: SessionState, checks: CommandChecks) => {
  const verdict = allowed(command, state, checks)
  return Schema.is(Allowed)(verdict)
    ? Effect.succeed(verdict)
    : Effect.fail(new CommandRefused({ reasons: verdict.reasons }))
}

/** A provider's next grant estimate: the implementer's for Claude, the reviewer's for Codex. */
const estimateOf =
  (settings: Pick<SessionSettings, "estimates">) =>
  (provider: Client): number =>
    settings.estimates[provider === Clients.Claude ? Roles.Implementer : Roles.Reviewer]
