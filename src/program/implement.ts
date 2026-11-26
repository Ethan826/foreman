// `implement [--waive]` (plan "Slice A1"): the session's first attempt.
// The launch protocol is attempt.ts; this file is only the implementer's
// plan: no handoff facts, no snapshot and no consent events, the brief is
// Format's implementer brief of the session's recorded task file (checked
// against its hash) and the session's owner rulings, the profile is
// Claude's editing profile, published for the session's worktree before
// admission (batch review B03) with the configured check commands, which
// the brief names too (dogfood-3b), and classification reads Claude's
// stream-json. The handoff is the final message of Claude's last
// `result` event, empty when it gave none (plan "Events",
// `ReportRecorded`).
import { Effect, Option } from "effect"
import { claudeEditingArgv } from "../domain/profiles.ts"
import { defaultRoleClients, Roles } from "../domain/roles.ts"
import { Implement } from "../domain/session.ts"
import type { OpenSession } from "../domain/session-state.ts"
import { implementBrief } from "../format/brief.ts"
import type { CheckCommandRefused, ProfilePathUnsafe } from "../format/claude-settings.ts"
import type { StateFileFailed } from "../runtime/state-files.ts"
import { type LaunchPlan, noFinishedExtras, noHandoffFacts, runAttempt } from "./attempt.ts"
import { claudeSettingsPath } from "./claude-profile.ts"
import { claudeDecoded, claudeHandoff } from "./client-output.ts"
import { recordedText } from "./recorded-files.ts"
import type { SessionContext } from "./session-context.ts"
import { type FileNotUtf8, TaskFileChanged } from "./session-errors.ts"

/** The owner's options for `implement`. */
export interface ImplementOptions {
  /** `--waive`: the owner consents to waive a Claude quota hold for this launch. */
  readonly waive: boolean
}

/** Runs `implement` (see attempt.ts for the protocol and its failures). */
export const implement = (context: SessionContext, options: ImplementOptions) =>
  runAttempt(context, implementPlan(context, options))

/** The implementer's launch plan. */
const implementPlan = (
  context: SessionContext,
  options: ImplementOptions,
): LaunchPlan<TaskFileChanged | FileNotUtf8 | ProfilePathUnsafe | CheckCommandRefused | StateFileFailed> => ({
  command: new Implement(),
  role: Roles.Implementer,
  provider: defaultRoleClients[Roles.Implementer],
  waive: options.waive,
  observe: () => Effect.succeed(noHandoffFacts),
  snapshot: () => Effect.succeed(Option.none()),
  prepare: ({ session }) =>
    Effect.gen(function* () {
      const task = yield* recordedTask(context, session)
      const { checkCommands } = context.settings
      yield* context.capabilities.publishClaudeProfile(session.opened.worktree, checkCommands)
      return { brief: implementBrief({ task, rulings: session.rulings, checkCommands }), round: 0, consent: [] }
    }),
  argv: (brief) => claudeEditingArgv({ brief, settingsFile: claudeSettingsPath(context.settings.stateDir) }),
  handoff: (_files, lines) => claudeHandoff(lines),
  decode: (lines) => ({ client: claudeDecoded(lines), findings: Option.none() }),
  afterHandoff: () => Effect.void,
  finishedExtras: noFinishedExtras,
})

/**
 * The session's task file as text, read from its published copy. Fails
 * with {@link TaskFileChanged} when it is missing or its hash differs
 * from the record, which leaves the session close-only, and with
 * `FileNotUtf8` when its bytes are not UTF-8 (review finding R04).
 */
export const recordedTask = (context: SessionContext, session: OpenSession) =>
  Effect.catchTag(
    recordedText(context, session.opened.taskPath, session.opened.taskSha256),
    "RecordedFileChanged",
    () => Effect.fail(new TaskFileChanged({ path: session.opened.taskPath })),
  )
