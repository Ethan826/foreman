// The recorded briefs of a session's attempts (review item B14). A brief
// is a file the log records by path and SHA-256, like a report, so a
// brief that is missing, changed, or never recorded for an attempt of the
// open session makes its reports count as not intact, and the handoff
// commands that need intact reports (`review`, `correct`) refuse.
import { Array as Arr, Effect, Option } from "effect"
import type { BriefRecorded } from "../domain/events.ts"
import type { SessionAttempt, SessionState } from "../domain/session-state.ts"
import { openSessionOf } from "../features/session-phases.ts"
import type { HandoffFacts } from "./attempt.ts"
import { fileIntact, type RecordedFileReader } from "./recorded-files.ts"
import type { SessionContext } from "./session-context.ts"

/** Whether every attempt of the open session has its brief recorded and intact; true with none open. */
export const briefsIntact = (context: SessionContext, state: SessionState) =>
  Option.match(openSessionOf(state), {
    onNone: () => Effect.succeed(true),
    onSome: (session) =>
      Effect.map(
        Effect.forEach(session.attempts, (attempt) => attemptBriefIntact(context, attempt)),
        Arr.every((intact) => intact),
      ),
  })

/** `facts` with `reportsIntact` false as well when a brief is not intact. */
export const withBriefsIntact =
  (context: SessionContext, state: SessionState) =>
  <E>(facts: Effect.Effect<HandoffFacts, E>) =>
    Effect.zipWith(facts, briefsIntact(context, state), (observed, intact) => ({
      ...observed,
      reportsIntact: observed.reportsIntact && intact,
    }))

/** Whether one attempt's brief is recorded and its file has the recorded hash. */
export const attemptBriefIntact = (context: RecordedFileReader, attempt: SessionAttempt) =>
  Option.match(attempt.brief, {
    onNone: () => Effect.succeed(false),
    onSome: (brief: BriefRecorded) => fileIntact(context, brief.briefPath, brief.briefSha256),
  })
