// The settings file of Claude's editing profile (batch review B03; owner
// ruling of 2026-11-20; design "Permissions"; the L3 subset renders its
// settings from this module through research/live/l3-subset/profile.sh):
// one fixed template, bound to the session's recorded git identity: the
// supervisor worktree's path, its own git directory and the repository's
// common git directory. The Bash sandbox denies writes to both git
// directories as wholes (owner ruling of 2026-11-23, dogfood-3a), because
// the L3 run's case C4 showed that code run in the sandbox could commit
// and move the supervisor branch in the common git directory. With them
// denied, `git status` and `git diff` cannot refresh the index; git skips
// that silently and still exits 0 with correct output.
// foreman writes it itself; the configuration cannot supply a settings
// file. A rule's `//` starts an absolute path, and `Edit(path)` governs Edit, Write and NotebookEdit,
// so writes are allowed by one `Edit(...)` rule (L3 plan, settings table).
// The sandbox keys come through `--settings` because a `false` from
// project settings would be ignored (same table).
//
// The template allows the check commands the owner's configuration names
// (dogfood-3b; owner rulings of 2026-11-23 and 2026-11-24), each as one
// exact `Bash(<command>)` rule after the `git diff` rules, and no others;
// with none named the bytes are those of the template without them. An
// exact rule limits the command line, not what runs: a command that runs
// repository code lets the agent run any code inside the Bash sandbox,
// which is the guard (check-command.ts). User settings and hooks stay out through the argv's
// `--setting-sources project,local`, and MCP servers through its
// `--strict-mcp-config` (owner ruling of 2026-11-20, L03; see
// `claudeEditingArgv`). The template adds `disableClaudeAiConnectors` as
// a second guard against claude.ai connectors: the 2.1.328 client honors
// it when any loaded source, `--settings` included, sets it, and then
// skips fetching the connectors.
import { Array as Arr, Formatter, Option, Result, Schema } from "effect"
import type { RecordedGitIdentity } from "../domain/session.ts"
import { checkCommandsRefusal } from "./check-command.ts"

/**
 * A path the template will not bind (the worktree's, its git directory
 * or the common git directory): not absolute, a doubled or
 * trailing slash, or a character outside letters, digits, `.`, `_`, `+`,
 * `-` and `/`, which a permission rule or a sandbox path could read as
 * syntax (a glob, a space, a parenthesis, a backslash, a line break).
 */
export class ProfilePathUnsafe extends Schema.TaggedError<ProfilePathUnsafe>()("ProfilePathUnsafe", {
  path: Schema.String,
}) {}

/**
 * A check command the template will not allow: one the configuration
 * decoder would refuse (check-command.ts). Decoding refuses it first;
 * this is the profile's second guard (owner ruling of 2026-11-24). A
 * launch stopped by it is a refusal and expires armed waivers.
 */
export class CheckCommandRefused extends Schema.TaggedError<CheckCommandRefused>()("CheckCommandRefused", {
  command: Schema.String,
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
 * The settings file's text for the session's recorded worktree
 * `identity` and the configured `checkCommands`, with a final newline;
 * the same inputs always give the same bytes, and an empty list gives the
 * template without check commands. Fails with {@link ProfilePathUnsafe}
 * naming the first of the worktree path, its git directory and the common
 * git directory that the template will not bind; otherwise with
 * {@link CheckCommandRefused} naming the first check command the
 * configuration decoder would refuse. Nothing is rendered before both
 * checks pass.
 */
export const claudeEditingSettings = (
  identity: RecordedGitIdentity,
  checkCommands: ReadonlyArray<string>,
): Result.Result<string, ProfilePathUnsafe | CheckCommandRefused> =>
  Option.match(Arr.findFirst([identity.path, identity.gitDir, identity.commonDir], isUnsafe), {
    onNone: () =>
      Option.match(checkCommandsRefusal(checkCommands), {
        onNone: () =>
          Result.succeed(`${Formatter.formatJson(profileFor(identity, checkCommands), { space: jsonIndent })}\n`),
        onSome: ({ command }) => Result.fail(new CheckCommandRefused({ command })),
      }),
    onSome: (path) => Result.fail(new ProfilePathUnsafe({ path })),
  })

/** Whether the template refuses to bind `path`; see {@link ProfilePathUnsafe}. */
const isUnsafe = (path: string): boolean => !plainAbsolutePath.test(path)

/**
 * The template's value for one recorded worktree. The sandbox denies
 * writes to the common git directory and the worktree's own git
 * directory as wholes, after the worktree's own entries, so code run in
 * the sandbox cannot write an object, a ref, a hook or the index (owner
 * ruling of 2026-11-23, dogfood-3a; L3 case C4). Each check command is
 * one exact rule, in configuration order, after the `git diff` rules.
 */
const profileFor = ({ path: worktree, gitDir, commonDir }: RecordedGitIdentity, checkCommands: ReadonlyArray<string>) => ({
  permissions: {
    defaultMode: "dontAsk",
    disableBypassPermissionsMode: "disable",
    allow: [
      `Read(/${worktree}/**)`,
      `Edit(/${worktree}/**)`,
      ...Arr.flatMap(allowedCommands, bareAndWithArguments),
      ...Arr.map(checkCommands, exactRule),
    ],
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
    filesystem: {
      denyWrite: [`${worktree}/.git`, ...Arr.map(protectedNames, topLevelPathIn(worktree)), commonDir, gitDir],
    },
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

/** A check command's one Bash rule, exactly as written: no `<command> *` form. */
const exactRule = (command: string) => `Bash(${command})`

/** A command's two Bash rules: the bare command and the command with arguments. */
const bareAndWithArguments = (command: string) => [`Bash(${command})`, `Bash(${command} *)`]
