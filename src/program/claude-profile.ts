// Publishing Claude's editing profile (batch review B03; owner ruling of
// 2026-11-20): the settings file Format renders from the fixed template
// for the session's recorded worktree, published atomically at one path in
// the state directory. `implement` and `correct` publish it in their
// prepare step, after the rules allow the command and before admission,
// and launch Claude with `--settings` naming that path, so the client
// reads the bytes just published. Whatever was at the path before, such as
// a file the owner or a client left there, is replaced.
import { Effect } from "effect"
import { claudeEditingSettings, type ProfilePathUnsafe } from "../format/claude-settings.ts"
import type { StateFileFailed, StateFiles } from "../runtime/state-files.ts"
import { utf8Bytes } from "./client-output.ts"

/** Publishes the profile for the worktree at `worktree`; fails without publishing on an unsafe path. */
export type PublishClaudeProfile = (worktree: string) => Effect.Effect<void, ProfilePathUnsafe | StateFileFailed>

/** Where the profile is published in the state directory `stateDir`. */
export const claudeSettingsPath = (stateDir: string): string => `${stateDir}/claude-settings.json`

/**
 * The production {@link PublishClaudeProfile}: renders the template for
 * the worktree and publishes it with `files` at
 * {@link claudeSettingsPath}.
 */
export const publishClaudeProfileWith =
  (files: StateFiles, stateDir: string): PublishClaudeProfile =>
  (worktree) =>
    Effect.gen(function* () {
      const text = yield* Effect.fromResult(claudeEditingSettings(worktree))
      yield* files.publish(claudeSettingsPath(stateDir), yield* utf8Bytes(text))
    })
