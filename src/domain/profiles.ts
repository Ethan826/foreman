// The two fixed permission profiles (plan "Profiles, environment and
// briefs"; decision P4; design "Permission profiles"): the argv foreman
// gives Claude to implement or correct, and Codex to review. Both are data
// built from a brief and the one file each needs, executable first. No
// bypass flag appears in either (AGENTS.md), and neither resumes or
// continues a session: every step starts in a fresh context.
import type { Array as Arr } from "effect"
import { Clients } from "./clients.ts"

/** What the editing profile is built from. */
export interface EditingProfileInput {
  /** The prompt Claude receives. */
  readonly brief: string
  /** The settings file holding the allow and deny lists and the sandbox settings. */
  readonly settingsFile: string
}

/** What the review profile is built from. */
export interface ReviewProfileInput {
  /** The prompt Codex receives. */
  readonly brief: string
  /** Where Codex writes its final message, the reviewer's handoff. */
  readonly lastMessageFile: string
}

/**
 * Claude's editing profile, for the implementer and the corrector:
 * `claude -p <brief> --output-format stream-json --verbose
 * --permission-mode dontAsk --permission-prompts none --settings
 * <settings-file> --setting-sources project,local --strict-mcp-config`.
 * Anything that would prompt is denied (`dontAsk`, and
 * `--permission-prompts none`, so no one is asked); the allow and deny
 * lists and the sandbox come from the settings file. No bypass flag, no
 * `--resume`, no `--continue`.
 *
 * The owner's ruling of 2026-11-21 (L03) settles what else loads.
 * `--setting-sources project,local` leaves out the user's settings,
 * hooks, `~/.claude/CLAUDE.md` and skills; the `--settings` file and managed policy load
 * whatever the flag says. `--strict-mcp-config` with no `--mcp-config`
 * starts no MCP server: none from a project `.mcp.json`, none at user
 * scope and no claude.ai connector. The target repository's project and
 * local settings still load.
 *
 * The exact flags are confirmed only by the L3 subset run
 * (research/live/l3-subset/plan.md), which has not run. A brief that
 * starts with `-` would be read as an option.
 */
export const claudeEditingArgv = (input: EditingProfileInput): Arr.NonEmptyReadonlyArray<string> => [
  Clients.Claude,
  "-p",
  input.brief,
  "--output-format",
  "stream-json",
  "--verbose",
  "--permission-mode",
  "dontAsk",
  "--permission-prompts",
  "none",
  "--settings",
  input.settingsFile,
  "--setting-sources",
  "project,local",
  "--strict-mcp-config",
]

/**
 * Codex's read-only review profile: `codex exec --sandbox read-only -c
 * approval_policy="never" --json --output-last-message <file> <brief>`.
 * The `-c` value is one argument, quotes included, so Codex parses it as
 * the TOML string `"never"`. No bypass flag and no `resume`.
 *
 * The exact flags are confirmed only by the L3 subset run
 * (research/live/l3-subset/plan.md), which has not run. A brief that
 * starts with `-` would be read as an option.
 */
export const codexReviewArgv = (input: ReviewProfileInput): Arr.NonEmptyReadonlyArray<string> => [
  Clients.Codex,
  "exec",
  "--sandbox",
  "read-only",
  "-c",
  'approval_policy="never"',
  "--json",
  "--output-last-message",
  input.lastMessageFile,
  input.brief,
]
