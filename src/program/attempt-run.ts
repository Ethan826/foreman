// Steps 5 to 7 of the write protocol (plan "Write protocol"): start the
// client with its fixed profile in the supervisor worktree and the
// parent's environment minus every `GIT_*` variable (decision P2), append
// batch L, show and keep its output, publish the raw file and the handoff
// file once the leader exits, publish what the plan derives from the
// handoff (a review's findings draft), classify the outcome in Features, and
// append batch F, `Finished` with its `ReportRecorded`, in one batch. The
// raw output streams into `<raw>.streaming`; the published raw file is a
// copy made atomically once the leader is done. The handoff's text is
// strict UTF-8 (review finding R04): a handoff that is not UTF-8 is
// published as it is, nothing is derived from it, and the plan decodes
// it as none.
import { Array as Arr, Clock, Effect, Option, Result, Stream } from "effect"
import { Finished, type Intended, Launched, type LogPosition } from "../domain/events.ts"
import type { StdoutLine, UndecodableLine } from "../domain/process.ts"
import { ReportRecorded } from "../domain/session-events.ts"
import type { OpenSession } from "../domain/session-state.ts"
import { clientEnvironment } from "../features/client-environment.ts"
import { classifyAttempt } from "../features/step-outcome.ts"
import type { LaunchPlan } from "./attempt.ts"
import { strictUtf8 } from "../runtime/strict-utf8.ts"
import type { SessionContext } from "./session-context.ts"

/** The files of one attempt, all in the state directory. */
export interface AttemptFiles {
  /** The exact brief the client receives, named by `BriefRecorded.briefPath`. */
  readonly brief: string
  /** The published raw output, named by `ReportRecorded.rawPath`. */
  readonly raw: string
  /** Where the raw output streams while the client runs. */
  readonly streaming: string
  /** The published handoff, named by `ReportRecorded.handoffPath`. */
  readonly handoff: string
  /** Where a client that writes its final message to a file writes it (Codex). */
  readonly lastMessage: string
}

/** What steps 5 to 7 run with, from the earlier steps. */
export interface LaunchState {
  readonly session: OpenSession
  readonly intent: Intended
  /** The brief as text, decoded from the bytes `BriefRecorded` names, so the argv carries exactly them. */
  readonly brief: string
  /** The log position after batch I. */
  readonly position: LogPosition
}

/** The attempt files of `opId` in `session`: `<stateDir>/<sessionId>.<opId>.<kind>`. */
export const attemptFiles = (stateDir: string, session: OpenSession, opId: string): AttemptFiles => {
  const stem = `${stateDir}/${session.opened.sessionId}.${opId}`
  return {
    brief: `${stem}.brief.md`,
    raw: `${stem}.raw.jsonl`,
    streaming: `${stem}.raw.jsonl.streaming`,
    handoff: `${stem}.handoff.md`,
    lastMessage: `${stem}.last-message.txt`,
  }
}

/** Steps 5 to 7; returns the classified outcome once batch F is written. */
export const runClient = <E>(context: SessionContext, plan: LaunchPlan<E>, state: LaunchState) =>
  Effect.gen(function* () {
    const { capabilities } = context
    const { opId } = state.intent
    const files = attemptFiles(context.settings.stateDir, state.session, opId)
    const running = yield* capabilities.startClient({
      argv: plan.argv(state.brief, files),
      cwd: state.session.opened.worktree.path,
      env: clientEnvironment(capabilities.parentEnvironment),
      rawPath: files.streaming,
    })
    const launched = new Launched({ opId, pgid: running.pgid, leaderStartedAt: running.leaderStartedAt })
    const position = yield* capabilities.log.append(state.position, [launched])
    const showLine = (line: StdoutLine) => capabilities.show(shown(line))
    const lines = Arr.fromIterable(yield* Stream.runCollect(Stream.tap(running.lines, showLine)))
    const exit = yield* running.exit
    const rawSha256 = yield* capabilities.stateFiles.publish(
      files.raw,
      yield* capabilities.stateFiles.read(files.streaming),
    )
    const handoff = yield* plan.handoff(files, lines)
    const handoffSha256 = yield* capabilities.stateFiles.publish(files.handoff, handoff)
    const handoffText = strictUtf8(handoff)
    yield* Option.match(handoffText, {
      onNone: () => Effect.void,
      onSome: (text) => plan.afterHandoff(state.session, text),
    })
    const outcome = classifyAttempt(plan.role, exit, plan.decode(lines, handoffText))
    const finished = new Finished({ opId, outcome, endedAt: yield* Clock.currentTimeMillis })
    const report = new ReportRecorded({
      sessionId: state.session.opened.sessionId,
      opId,
      role: plan.role,
      rawPath: files.raw,
      rawSha256,
      handoffPath: files.handoff,
      handoffSha256,
    })
    yield* capabilities.log.append(position, [finished, report])
    return outcome
  })

/** What the owner sees for a stdout line: its text, or a notice when it is not UTF-8. */
const shown = (line: StdoutLine): string => Result.getOrElse(line, undecodableNotice)

/** The notice shown in place of a stdout line that is not UTF-8; the raw file keeps its bytes. */
const undecodableNotice = (line: UndecodableLine): string =>
  `[tarlatan: a line of ${String(line.byteLength)} bytes is not valid UTF-8; the raw file keeps it]`
