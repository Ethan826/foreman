// The editing profile's settings file (batch review B03; owner ruling of
// 2026-11-20): the fixed template bound to one recorded git identity. The
// whole template is checked through production in
// test/program/production-profile.test.ts; here, the path binding, the
// denials of both git directories (owner ruling of 2026-11-23,
// dogfood-3a), and the paths the template refuses to bind.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Effect, Result, Schema, String as Str } from "effect"
import type { RecordedGitIdentity } from "../../src/domain/session.ts"
import { claudeEditingSettings, ProfilePathUnsafe } from "../../src/format/claude-settings.ts"

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
  Effect.flatMap(Effect.fromResult(claudeEditingSettings(bound)), Schema.decodeUnknownEffect(Settings))

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
    expect(claudeEditingSettings(identityAt(path))).toEqual(Result.fail(new ProfilePathUnsafe({ path })))
  })
}

const refusesUnsafeGitDir = () => {
  Arr.forEach(unsafePaths, (path) => {
    expect(claudeEditingSettings({ ...identity, gitDir: path })).toEqual(Result.fail(new ProfilePathUnsafe({ path })))
  })
}

const refusesUnsafeCommonDir = () => {
  Arr.forEach(unsafePaths, (path) => {
    expect(claudeEditingSettings({ ...identity, commonDir: path })).toEqual(Result.fail(new ProfilePathUnsafe({ path })))
  })
}

describe("claudeEditingSettings", () => {
  it.effect("binds every file rule and every sandbox path to the worktree", bindsEveryPath)

  it.effect("denies sandbox writes to the common git directory and the worktree's git directory, last", deniesBothGitDirectories)

  it("is the same text for the same path, ending with a newline", () => {
    expect(claudeEditingSettings(identity)).toEqual(claudeEditingSettings(identity))
    expect(Str.endsWith("}\n")(Result.getOrElse(claudeEditingSettings(identity), () => ""))).toBe(true)
  })

  it.effect("keeps the sandbox on, with no unsandboxed commands and no network", () =>
    Effect.gen(function* () {
      const { sandbox } = yield* parsed(identity)
      expect([sandbox.enabled, sandbox.failIfUnavailable, sandbox.allowUnsandboxedCommands]).toEqual([true, true, false])
      expect(sandbox.network.allowedDomains).toEqual([])
    }))

  it.effect("switches off claude.ai connectors", () =>
    Effect.gen(function* () {
      const text = yield* Effect.fromResult(claudeEditingSettings(identity))
      const { disableClaudeAiConnectors } = yield* Schema.decodeUnknownEffect(ConnectorSwitch)(text)
      expect(disableClaudeAiConnectors).toBe(true)
    }))

  it("refuses a path that is relative, has a doubled slash, or holds a character a rule could read as syntax", refusesUnsafeWorktree)
  it("refuses such a path as the worktree's git directory", refusesUnsafeGitDir)
  it("refuses such a path as the common git directory", refusesUnsafeCommonDir)
})
