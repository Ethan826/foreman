// The settings file of Claude's editing profile (batch review B03; owner
// ruling of 2026-11-20; design "Permissions"; the L3 subset renders its
// settings from this module through research/live/l3-subset/profile.sh):
// one fixed template, bound to the recorded supervisor worktree's path.
// foreman writes it itself; the configuration cannot supply a settings
// file. A rule's `//` starts an absolute path, and `Edit(path)` governs Edit, Write and NotebookEdit,
// so writes are allowed by one `Edit(...)` rule (L3 plan, settings table).
// The sandbox keys come through `--settings` because a `false` from
// project settings would be ignored (same table).
//
// The template allows no target test command on purpose: the L3
// template's `Bash(sh check.sh)` stands in for one, and no ruling names
// production's. User settings and hooks stay out through the argv's
// `--setting-sources project,local`, and MCP servers through its
// `--strict-mcp-config` (owner ruling of 2026-11-20, L03; see
// `claudeEditingArgv`). The template adds `disableClaudeAiConnectors` as
// a second guard against claude.ai connectors: the 2.1.328 client honors
// it when any loaded source, `--settings` included, sets it, and then
// skips fetching the connectors.
import { Array as Arr, Formatter, Result, Schema } from "effect"

/**
 * A worktree path the template will not bind: not absolute, a doubled or
 * trailing slash, or a character outside letters, digits, `.`, `_`, `+`,
 * `-` and `/`, which a permission rule or a sandbox path could read as
 * syntax (a glob, a space, a parenthesis, a backslash, a line break).
 */
export class ProfilePathUnsafe extends Schema.TaggedError<ProfilePathUnsafe>()("ProfilePathUnsafe", {
  path: Schema.String,
}) {}

/** The indent of the settings file's JSON, in spaces. */
const jsonIndent = 2

/** An absolute path of plain components: no doubled or trailing slash, no syntax characters. */
const plainAbsolutePath = /^(?:\/[A-Za-z0-9._+-]+)+$/

/** The names the profile protects from writes anywhere in the worktree (design "Protected paths"). */
const protectedNames = [
  "CLAUDE.md",
  "CLAUDE.local.md",
  "AGENTS.md",
  ".claude",
  ".codex",
  ".mcp.json",
  ".gitattributes",
  ".gitmodules",
] as const

/** Commands the profile denies, each in its bare and its `<command> *` form. */
const deniedCommands = ["git commit", "git push", "git config", "curl"] as const

/** Read-only git commands the profile allows, bare and with arguments. */
const allowedCommands = ["git status", "git diff"] as const

/**
 * The settings file's text for the worktree at `worktree`, with a final
 * newline; the same path always gives the same bytes. Fails with
 * {@link ProfilePathUnsafe} for a path the template will not bind.
 */
export const claudeEditingSettings = (worktree: string): Result.Result<string, ProfilePathUnsafe> =>
  plainAbsolutePath.test(worktree)
    ? Result.succeed(`${Formatter.formatJson(profileFor(worktree), { space: jsonIndent })}\n`)
    : Result.fail(new ProfilePathUnsafe({ path: worktree }))

/** The template's value for one worktree. */
const profileFor = (worktree: string) => ({
  permissions: {
    defaultMode: "dontAsk",
    disableBypassPermissionsMode: "disable",
    allow: [`Read(/${worktree}/**)`, `Edit(/${worktree}/**)`, ...Arr.flatMap(allowedCommands, bareAndWithArguments)],
    deny: [
      `Edit(/${worktree}/.git)`,
      ...Arr.map(protectedNames, protectedRuleIn(worktree)),
      ...Arr.flatMap(deniedCommands, bareAndWithArguments),
      "WebFetch",
      "WebSearch",
    ],
  },
  sandbox: {
    enabled: true,
    failIfUnavailable: true,
    allowUnsandboxedCommands: false,
    autoAllowBashIfSandboxed: false,
    filesystem: { denyWrite: [`${worktree}/.git`, ...Arr.map(protectedNames, topLevelPathIn(worktree))] },
    network: { allowedDomains: [] },
  },
  autoMemoryEnabled: false,
  disableClaudeAiConnectors: true,
})

/** The deny rule for a protected name at any depth: a directory's contents, or the file itself. */
const protectedRuleIn = (worktree: string) => (name: string) =>
  isProtectedDirectory(name) ? `Edit(/${worktree}/**/${name}/**)` : `Edit(/${worktree}/**/${name})`

/** A protected name's path at the worktree's top level, for the sandbox's write denials. */
const topLevelPathIn = (worktree: string) => (name: string) => `${worktree}/${name}`

/** The protected names that are directories, whose contents the rule covers. */
const isProtectedDirectory = (name: string) => name === ".claude" || name === ".codex"

/** A command's two Bash rules: the bare command and the command with arguments. */
const bareAndWithArguments = (command: string) => [`Bash(${command})`, `Bash(${command} *)`]
