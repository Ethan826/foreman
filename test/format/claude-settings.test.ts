// The editing profile's settings file (batch review B03; owner ruling of
// 2026-11-20): the fixed template bound to one recorded git identity. The
// whole template is checked through production in
// test/program/production-profile.test.ts; here, the path binding, the
// denials of both git directories (owner ruling of 2026-11-23,
// dogfood-3a), the paths the template refuses to bind, and the check
// commands: none leaves today's bytes, each is one exact rule after the
// `git diff` rules, and a refused one fails (dogfood-3b).
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Effect, Formatter, Result, Schema, String as Str } from "effect"
import type { RecordedGitIdentity } from "../../src/domain/session.ts"
import { CheckCommandRefused, claudeEditingSettings, ProfilePathUnsafe } from "../../src/format/claude-settings.ts"

const worktree = "/state/foreman_t-1/worktree"
const gitDir = "/owner/.git/worktrees/worktree"
const commonDir = "/owner/.git"

/** The recorded identity of the worktree at `path`, with the fixed git directories. */
const identityAt = (path: string): RecordedGitIdentity => ({ path, gitDir, commonDir })

const identity = identityAt(worktree)

/** The parts of the settings file these cases read. */
const Settings = Schema.fromJsonString(
  Schema.Struct({
    permissions: Schema.Struct({ allow: Schema.Array(Schema.String), deny: Schema.Array(Schema.String) }),
    sandbox: Schema.Struct({
      enabled: Schema.Boolean,
      failIfUnavailable: Schema.Boolean,
      allowUnsandboxedCommands: Schema.Boolean,
      filesystem: Schema.Struct({ denyWrite: Schema.Array(Schema.String) }),
      network: Schema.Struct({ allowedDomains: Schema.Array(Schema.String) }),
    }),
  }),
)

/** The template's connector switch (owner ruling of 2026-11-20). */
const ConnectorSwitch = Schema.fromJsonString(Schema.Struct({ disableClaudeAiConnectors: Schema.Boolean }))

const isFileRule = (rule: string) => /^(Read|Edit)\(/.test(rule)
const boundRule = (rule: string) => rule.includes(`(/${worktree}/`)
const insideWorktree = (path: string) => path === worktree || Str.startsWith(`${worktree}/`)(path)
const isRecordedGitDirectory = (path: string) => path === gitDir || path === commonDir
const boundSandboxPath = (path: string) => insideWorktree(path) || isRecordedGitDirectory(path)

const parsed = (bound: RecordedGitIdentity) =>
  Effect.flatMap(Effect.fromResult(claudeEditingSettings(bound, [])), Schema.decodeUnknownEffect(Settings))

const bindsEveryPath = () =>
  Effect.gen(function* () {
    const settings = yield* parsed(identity)
    const fileRules = Arr.filter([...settings.permissions.allow, ...settings.permissions.deny], isFileRule)
    expect(fileRules.length).toBe(11)
    expect(Arr.every(fileRules, boundRule)).toBe(true)
    expect(Arr.every(settings.sandbox.filesystem.denyWrite, boundSandboxPath)).toBe(true)
  })

const deniesBothGitDirectories = () =>
  Effect.gen(function* () {
    const { denyWrite } = (yield* parsed(identity)).sandbox.filesystem
    expect(Arr.takeRight(denyWrite, 2)).toEqual([commonDir, gitDir])
    expect(Arr.filter(denyWrite, isRecordedGitDirectory)).toEqual([commonDir, gitDir])
  })

/** Every path the refusal case names, each refused as the worktree path. */
const unsafePaths = ["state/worktree", "//state/worktree", "/state//worktree", "/a b", "/a*", "/a(b)", "/a\nb", "/a\\b", "/", "/a/"]

const refusesUnsafeWorktree = () => {
  Arr.forEach(unsafePaths, (path) => {
    expect(claudeEditingSettings(identityAt(path), [])).toEqual(Result.fail(new ProfilePathUnsafe({ path })))
  })
}

const refusesUnsafeGitDir = () => {
  Arr.forEach(unsafePaths, (path) => {
    expect(claudeEditingSettings({ ...identity, gitDir: path }, [])).toEqual(Result.fail(new ProfilePathUnsafe({ path })))
  })
}

const refusesUnsafeCommonDir = () => {
  Arr.forEach(unsafePaths, (path) => {
    expect(claudeEditingSettings({ ...identity, commonDir: path }, [])).toEqual(Result.fail(new ProfilePathUnsafe({ path })))
  })
}

/**
 * Today's profile for `identity` with no check commands, written out
 * (equal to production-profile.test.ts's `expectedProfile`): the byte pin
 * that an empty list of check commands leaves the template as it was.
 */
const profileWithoutCheckCommands = {
  permissions: {
    defaultMode: "dontAsk",
    disableBypassPermissionsMode: "disable",
    allow: [
      `Read(/${worktree}/**)`,
      `Edit(/${worktree}/**)`,
      "Bash(git status)",
      "Bash(git status *)",
      "Bash(git diff)",
      "Bash(git diff *)",
    ],
    deny: [
      `Edit(/${worktree}/.git)`,
      `Edit(/${worktree}/**/CLAUDE.md)`,
      `Edit(/${worktree}/**/CLAUDE.local.md)`,
      `Edit(/${worktree}/**/AGENTS.md)`,
      `Edit(/${worktree}/**/.claude/**)`,
      `Edit(/${worktree}/**/.codex/**)`,
      `Edit(/${worktree}/**/.mcp.json)`,
      `Edit(/${worktree}/**/.gitattributes)`,
      `Edit(/${worktree}/**/.gitmodules)`,
      "Bash(git commit)",
      "Bash(git commit *)",
      "Bash(git push)",
      "Bash(git push *)",
      "Bash(git config)",
      "Bash(git config *)",
      "Bash(curl)",
      "Bash(curl *)",
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
      denyWrite: [
        `${worktree}/.git`,
        `${worktree}/CLAUDE.md`,
        `${worktree}/CLAUDE.local.md`,
        `${worktree}/AGENTS.md`,
        `${worktree}/.claude`,
        `${worktree}/.codex`,
        `${worktree}/.mcp.json`,
        `${worktree}/.gitattributes`,
        `${worktree}/.gitmodules`,
        commonDir,
        gitDir,
      ],
    },
    network: { allowedDomains: [] },
  },
  autoMemoryEnabled: false,
  disableClaudeAiConnectors: true,
}

const pinnedWithoutCheckCommands = () => {
  expect(claudeEditingSettings(identity, [])).toEqual(
    Result.succeed(`${Formatter.formatJson(profileWithoutCheckCommands, { space: 2 })}\n`),
  )
}

/** Two check commands, in configuration order. */
const twoCommands = ["bun run verify", "bun run test"]

const exactRulesAfterGitDiff = () =>
  Effect.gen(function* () {
    const text = yield* Effect.fromResult(claudeEditingSettings(identity, twoCommands))
    const settings = yield* Schema.decodeUnknownEffect(Settings)(text)
    expect(settings.permissions.allow).toEqual([
      ...profileWithoutCheckCommands.permissions.allow,
      "Bash(bun run verify)",
      "Bash(bun run test)",
    ])
    expect(settings.permissions.deny).toEqual(profileWithoutCheckCommands.permissions.deny)
    expect(Arr.filter(settings.permissions.allow, Str.startsWith("Bash(bun"))).toEqual(["Bash(bun run verify)", "Bash(bun run test)"])
  })

const refusesCheckCommands = () => {
  expect(claudeEditingSettings(identity, ["bun run verify", "git commit"])).toEqual(
    Result.fail(new CheckCommandRefused({ command: "git commit" })),
  )
  expect(claudeEditingSettings(identity, ["curl x"])).toEqual(Result.fail(new CheckCommandRefused({ command: "curl x" })))
  expect(claudeEditingSettings(identity, ["bun run verify", "bun run verify"])).toEqual(
    Result.fail(new CheckCommandRefused({ command: "bun run verify" })),
  )
}

const unsafePathWins = () => {
  expect(claudeEditingSettings(identityAt("/a b"), ["git commit"])).toEqual(Result.fail(new ProfilePathUnsafe({ path: "/a b" })))
}

describe("claudeEditingSettings with check commands (dogfood-3b)", () => {
  it("with none, renders exactly today's profile", pinnedWithoutCheckCommands)
  it.effect("adds one exact rule per command, in order, right after the git diff rules", exactRulesAfterGitDiff)
  it("refuses a check command the configuration decoder would refuse", refusesCheckCommands)
  it("refuses an unsafe path before a refused check command", unsafePathWins)
})

describe("claudeEditingSettings", () => {
  it.effect("binds every file rule and every sandbox path to the worktree", bindsEveryPath)

  it.effect("denies sandbox writes to the common git directory and the worktree's git directory, last", deniesBothGitDirectories)

  it("is the same text for the same path, ending with a newline", () => {
    expect(claudeEditingSettings(identity, [])).toEqual(claudeEditingSettings(identity, []))
    expect(Str.endsWith("}\n")(Result.getOrElse(claudeEditingSettings(identity, []), () => ""))).toBe(true)
  })

  it.effect("keeps the sandbox on, with no unsandboxed commands and no network", () =>
    Effect.gen(function* () {
      const { sandbox } = yield* parsed(identity)
      expect([sandbox.enabled, sandbox.failIfUnavailable, sandbox.allowUnsandboxedCommands]).toEqual([true, true, false])
      expect(sandbox.network.allowedDomains).toEqual([])
    }))

  it.effect("switches off claude.ai connectors", () =>
    Effect.gen(function* () {
      const text = yield* Effect.fromResult(claudeEditingSettings(identity, []))
      const { disableClaudeAiConnectors } = yield* Schema.decodeUnknownEffect(ConnectorSwitch)(text)
      expect(disableClaudeAiConnectors).toBe(true)
    }))

  it("refuses a path that is relative, has a doubled slash, or holds a character a rule could read as syntax", refusesUnsafeWorktree)
  it("refuses such a path as the worktree's git directory", refusesUnsafeGitDir)
  it("refuses such a path as the common git directory", refusesUnsafeCommonDir)
})
