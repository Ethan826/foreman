// `implement [--waive]` (plan "Slice A1"): the session's first attempt.
// The launch protocol is attempt.ts; this file is only the implementer's
// plan: no handoff facts and no consent events, the brief is the
// session's recorded task file (checked against its hash), the profile is
// Claude's editing profile, and classification reads Claude's
// stream-json. Claude gives no handoff file here, so the handoff is empty
// (plan "Events", `ReportRecorded`).
import { Effect, Option } from "effect"
import { claudeEditingArgv } from "../domain/profiles.ts"
import { defaultRoleClients, Roles } from "../domain/roles.ts"
import { Implement } from "../domain/session.ts"
import type { OpenSession } from "../domain/session-state.ts"
import { sha256Of } from "../runtime/state-files.ts"
import { type LaunchPlan, noHandoffFacts, runAttempt } from "./attempt.ts"
import { claudeDecoded, utf8Text } from "./client-output.ts"
import type { SessionContext } from "./session-context.ts"
import { TaskFileChanged } from "./session-errors.ts"

/** The owner's options for `implement`. */
export interface ImplementOptions {
  /** `--waive`: the owner consents to waive a Claude quota hold for this launch. */
  readonly waive: boolean
}

/** Runs `implement` (see attempt.ts for the protocol and its failures). */
export const implement = (context: SessionContext, options: ImplementOptions) =>
  runAttempt(context, implementPlan(context, options))

/** The implementer's launch plan. */
const implementPlan = (context: SessionContext, options: ImplementOptions): LaunchPlan<TaskFileChanged> => ({
  command: new Implement(),
  role: Roles.Implementer,
  provider: defaultRoleClients[Roles.Implementer],
  waive: options.waive,
  observe: () => Effect.succeed(noHandoffFacts),
  prepare: (session) => Effect.map(recordedTask(context, session), (brief) => ({ brief, round: 0, consent: [] })),
  argv: (brief) => claudeEditingArgv({ brief, settingsFile: context.settings.claudeSettings }),
  handoff: () => Effect.succeed(new Uint8Array()),
  decode: (lines) => ({ client: claudeDecoded(lines), findings: Option.none() }),
})

/**
 * The session's task file as text, read from its published copy. Fails
 * with {@link TaskFileChanged} when it is missing or its hash differs
 * from the record, which leaves the session close-only.
 */
const recordedTask = (context: SessionContext, session: OpenSession) =>
  Effect.gen(function* () {
    const path = session.opened.taskPath
    const bytes = yield* Effect.mapError(context.capabilities.stateFiles.read(path), () => new TaskFileChanged({ path }))
    if (sha256Of(bytes) !== session.opened.taskSha256) return yield* new TaskFileChanged({ path })
    return yield* utf8Text(bytes)
  })
