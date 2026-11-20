// Questions the command rules ask of a session state (plan "Commands and
// their prerequisites"): whether a session is open, and which handoff,
// if any, the last attempt awaits.
import { Match, Option, Schema } from "effect"
import { ChangesRequested, Success } from "../domain/outcomes.ts"
import { Roles } from "../domain/roles.ts"
import {
  AwaitingHandoff,
  NoSession,
  OpenNoAttempt,
  type OpenSession,
  Rejected,
  SessionEnded,
  type SessionState,
} from "../domain/session-state.ts"

/** The open session's facts in `state`, or none when no session is open. */
export const openSessionOf = (
  state: SessionState,
): Option.Option<OpenSession> =>
  Match.value(state).pipe(
    Match.tag("NoSession", "SessionEnded", () => Option.none()),
    Match.orElse((open) => Option.some(open.session)),
  )

/** No session is open: none was opened, or the last one closed. */
export const noneOpen = (state: SessionState): boolean =>
  Schema.is(NoSession)(state) || Schema.is(SessionEnded)(state)

/** An open session with no incomplete attempt (close `--abandoned`). */
export const openWithoutIncomplete = (state: SessionState): boolean =>
  Schema.is(OpenNoAttempt)(state) ||
  Schema.is(AwaitingHandoff)(state) ||
  Schema.is(Rejected)(state)

/** A usable attempt awaits its handoff (`reject`). */
export const awaitsUsable = (state: SessionState): boolean =>
  Schema.is(AwaitingHandoff)(state) && state.usable

/** A usable implement or correct awaits its review (`review`). */
export const awaitsReview = (state: SessionState): boolean =>
  Schema.is(AwaitingHandoff)(state) &&
  state.usable &&
  state.role !== Roles.Reviewer

/** A review that asked for changes awaits its correction (`correct`). */
export const awaitsCorrection = (state: SessionState): boolean =>
  Schema.is(AwaitingHandoff)(state) &&
  state.role === Roles.Reviewer &&
  Schema.is(ChangesRequested)(state.outcome)

/** A review with no changes requested awaits the close (`close --finished`). */
export const awaitsClose = (state: SessionState): boolean =>
  Schema.is(AwaitingHandoff)(state) &&
  state.role === Roles.Reviewer &&
  Schema.is(Success)(state.outcome)
