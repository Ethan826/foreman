// The assisted session fold (plan "Commands and their prerequisites",
// "Write protocol", "Outcomes and usable attempts"): the state of the
// current session, read from the project log alone. One session is open
// at a time; an attempt belongs to the session open when its `Intended`
// was written, and events naming another session are ignored. The fold
// has no clock input, so nothing changes state but a log event.
import { Array as Arr, Match, Option } from "effect"
import { Clients } from "../domain/clients.ts"
import type {
  HandoffApproved,
  Intended,
  ProjectEvent,
  ReportRecorded,
  SessionClosed,
  SessionOpened,
} from "../domain/events.ts"
import type { OpId } from "../domain/ids.ts"
import { Roles } from "../domain/roles.ts"
import {
  AttemptIncomplete,
  AwaitingHandoff,
  Interrupted,
  NoSession,
  OpenNoAttempt,
  type OpenSession,
  Rejected,
  type SessionAttempt,
  SessionEnded,
  type SessionFold,
  type SessionState,
} from "../domain/session-state.ts"
import {
  attestedBy,
  briefBy,
  finishedBy,
  isIncomplete,
  launchedBy,
  newAttempt,
} from "./session-attempts.ts"
import { usable } from "./step-outcome.ts"
import { armedWaiver } from "./waiver.ts"

/** The fold's running state: the open session, or the last one's end. */
interface Running {
  readonly open: Option.Option<OpenRunning>
  readonly ended: Option.Option<SessionEnded>
}

/** An open session as the fold builds it, with its latest rejection. */
interface OpenRunning {
  readonly session: OpenSession
  readonly rejected: Option.Option<OpId>
}

/**
 * Folds the project log into the current session's state and the armed
 * waiver of each provider. States: `NoSession`; `SessionEnded`;
 * `OpenNoAttempt`; `AttemptIncomplete` while an attempt has no `Finished`
 * and one of those lacks the owner's attestation; `Interrupted` once
 * every incomplete attempt has it; `Rejected` after the owner's
 * rejection; and `AwaitingHandoff` after the last attempt finished, with
 * its role, outcome and usability. An incomplete attempt outranks a
 * rejection, and a rejection outranks the last finished attempt.
 */
export const foldSession = (log: ReadonlyArray<ProjectEvent>): SessionFold => ({
  state: stateOf(Arr.reduce(log, initial, step)),
  armedWaivers: {
    [Clients.Claude]: armedWaiver(log, Clients.Claude),
    [Clients.Codex]: armedWaiver(log, Clients.Codex),
  },
})

/** No session opened yet. */
const initial: Running = { open: Option.none(), ended: Option.none() }

/** The running state after one event; events outside a session change nothing. */
const step = (running: Running, event: ProjectEvent): Running =>
  Match.value(event).pipe(
    Match.tag("SessionOpened", openedBy),
    Match.tag("SessionClosed", (closed) => closedBy(running, closed)),
    Match.orElse(() => inOpen(running, (open) => openStep(open, event))),
  )

/** A fresh open session; whatever came before is no longer current. */
const openedBy = (opened: SessionOpened): Running => ({
  open: Option.some({
    session: {
      opened,
      attempts: [],
      reports: [],
      corrections: 0,
      reviewedTree: Option.none(),
    },
    rejected: Option.none(),
  }),
  ended: Option.none(),
})

/** Closes the open session when the close names it. */
const closedBy = (running: Running, closed: SessionClosed): Running =>
  Option.exists(running.open, (open) => names(open, closed.sessionId))
    ? {
        open: Option.none(),
        ended: Option.some(new SessionEnded({ sessionId: closed.sessionId, how: closed.how })),
      }
    : running

/** Applies `change` to the open session, if there is one. */
const inOpen = (
  running: Running,
  change: (open: OpenRunning) => OpenRunning,
): Running => ({ ...running, open: Option.map(running.open, change) })

/** One event's effect on the open session. */
const openStep = (open: OpenRunning, event: ProjectEvent): OpenRunning =>
  Match.value(event).pipe(
    Match.tag("Intended", (intent) => withAttempt(open, intent)),
    Match.tag("BriefRecorded", (brief) =>
      inSession(open, brief.sessionId, (current) => updateAttempt(current, brief.opId, briefBy(brief))),
    ),
    Match.tag("Launched", (launch) => updateAttempt(open, launch.opId, launchedBy(launch))),
    Match.tag("Finished", (finish) => updateAttempt(open, finish.opId, finishedBy(finish))),
    Match.tag("StepEndedByOwner", (ended) => updateAttempt(open, ended.opId, attestedBy(ended))),
    Match.tag("ReportRecorded", (report) => inSession(open, report.sessionId, withReport(report))),
    Match.tag("HandoffApproved", (handoff) =>
      inSession(open, handoff.sessionId, withHandoff(handoff)),
    ),
    Match.tag("HandoffRejected", (rejection) =>
      inSession(open, rejection.sessionId, (current) => ({
        ...current,
        rejected: Option.some(rejection.fromOpId),
      })),
    ),
    Match.orElse(() => open),
  )

/** Whether `open` is the session `sessionId` names. */
const names = (open: OpenRunning, sessionId: string): boolean =>
  open.session.opened.sessionId === sessionId

/** Applies `change` only when the event names the open session. */
const inSession = (
  open: OpenRunning,
  sessionId: string,
  change: (current: OpenRunning) => OpenRunning,
): OpenRunning => (names(open, sessionId) ? change(open) : open)

/** Adds an attempt; a corrector's attempt counts as one correction. */
const withAttempt = (open: OpenRunning, intent: Intended): OpenRunning => ({
  ...open,
  session: {
    ...open.session,
    attempts: Arr.append(open.session.attempts, newAttempt(intent)),
    corrections:
      open.session.corrections + (intent.step.role === Roles.Corrector ? 1 : 0),
  },
})

/** Applies `change` to the attempt `opId`, leaving the others alone. */
const updateAttempt = (
  open: OpenRunning,
  opId: OpId,
  change: (attempt: SessionAttempt) => SessionAttempt,
): OpenRunning => ({
  ...open,
  session: {
    ...open.session,
    attempts: Arr.map(open.session.attempts, (attempt) =>
      attempt.intent.opId === opId ? change(attempt) : attempt,
    ),
  },
})

/** Keeps a recorded report. */
const withReport = (report: ReportRecorded) => (open: OpenRunning): OpenRunning => ({
  ...open,
  session: { ...open.session, reports: Arr.append(open.session.reports, report) },
})

/** A handoff to a reviewer sets the reviewed tree to the tree it gives. */
const withHandoff = (handoff: HandoffApproved) => (open: OpenRunning): OpenRunning =>
  handoff.toRole === Roles.Reviewer
    ? { ...open, session: { ...open.session, reviewedTree: Option.some(handoff.tree) } }
    : open

/** The state the running fold ends in. */
const stateOf = (running: Running): SessionState =>
  Option.match(running.open, {
    onNone: () => Option.getOrElse(running.ended, () => new NoSession()),
    onSome: openState,
  })

/** An open session's state: incomplete, then rejected, then the last attempt. */
const openState = (open: OpenRunning): SessionState => {
  const incomplete = Arr.filter(open.session.attempts, isIncomplete)
  return Arr.isReadonlyArrayNonEmpty(incomplete)
    ? incompleteState(open.session, incomplete)
    : Option.match(open.rejected, {
        onSome: (fromOpId) => new Rejected({ session: open.session, fromOpId }),
        onNone: () => lastAttemptState(open.session),
      })
}

/** Interrupted when the owner attested every incomplete attempt. */
const incompleteState = (
  session: OpenSession,
  incomplete: ReadonlyArray<SessionAttempt>,
): SessionState =>
  Arr.every(incomplete, (attempt) => Option.isSome(attempt.endedByOwner))
    ? new Interrupted({ session, incomplete })
    : new AttemptIncomplete({ session, incomplete })

/** Awaiting a handoff after the last attempt, or open with no attempt. */
const lastAttemptState = (session: OpenSession): SessionState =>
  Option.getOrElse(
    Option.flatMap(Arr.last(session.attempts), awaitedAfter(session)),
    (): SessionState => new OpenNoAttempt({ session }),
  )

/** The handoff awaited after a finished attempt. */
const awaitedAfter = (session: OpenSession) => (attempt: SessionAttempt) =>
  Option.map(attempt.finished, (finish) => {
    const role = attempt.intent.step.role
    return new AwaitingHandoff({
      session,
      opId: attempt.intent.opId,
      role,
      outcome: finish.outcome,
      usable: usable(role, finish.outcome),
    })
  })
