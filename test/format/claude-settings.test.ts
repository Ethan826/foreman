// The editing profile's settings file (batch review B03; owner ruling of
// 2026-11-20): the fixed template bound to one worktree path. The whole
// template is checked through production in
// test/program/production-profile.test.ts; here, the path binding and the
// paths the template refuses to bind.
import { describe, expect, it } from "@effect/vitest"
import { Effect, Result, Schema } from "effect"
import { claudeEditingSettings, ProfilePathUnsafe } from "../../src/format/claude-settings.ts"

const worktree = "/state/foreman_t-1/worktree"

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

/** The template's connector switch (owner ruling of 2026-11-21). */
const ConnectorSwitch = Schema.fromJsonString(Schema.Struct({ disableClaudeAiConnectors: Schema.Boolean }))

const isFileRule = (rule: string) => /^(Read|Edit)\(/.test(rule)
const boundRule = (rule: string) => rule.includes(`(/${worktree}/`)
const insideWorktree = (path: string) => path.startsWith(`${worktree}/`)

const parsed = (path: string) =>
  Effect.flatMap(Effect.fromResult(claudeEditingSettings(path)), Schema.decodeUnknownEffect(Settings))

describe("claudeEditingSettings", () => {
  it.effect("binds every file rule and every sandbox path to the worktree", () =>
    Effect.gen(function* () {
      const settings = yield* parsed(worktree)
      const fileRules = [...settings.permissions.allow, ...settings.permissions.deny].filter(isFileRule)
      expect(fileRules.length).toBe(11)
      expect(fileRules.every(boundRule)).toBe(true)
      expect(settings.sandbox.filesystem.denyWrite.every(insideWorktree)).toBe(true)
    }))

  it("is the same text for the same path, ending with a newline", () => {
    expect(claudeEditingSettings(worktree)).toEqual(claudeEditingSettings(worktree))
    expect(Result.getOrElse(claudeEditingSettings(worktree), () => "").endsWith("}\n")).toBe(true)
  })

  it.effect("keeps the sandbox on, with no unsandboxed commands and no network", () =>
    Effect.gen(function* () {
      const { sandbox } = yield* parsed(worktree)
      expect([sandbox.enabled, sandbox.failIfUnavailable, sandbox.allowUnsandboxedCommands]).toEqual([true, true, false])
      expect(sandbox.network.allowedDomains).toEqual([])
    }))

  it.effect("switches off claude.ai connectors", () =>
    Effect.gen(function* () {
      const text = yield* Effect.fromResult(claudeEditingSettings(worktree))
      const { disableClaudeAiConnectors } = yield* Schema.decodeUnknownEffect(ConnectorSwitch)(text)
      expect(disableClaudeAiConnectors).toBe(true)
    }))

  it("refuses a path that is relative, has a doubled slash, or holds a character a rule could read as syntax", () => {
    for (const path of ["state/worktree", "//state/worktree", "/state//worktree", "/a b", "/a*", "/a(b)", "/a\nb", "/a\\b", "/", "/a/"]) {
      expect(claudeEditingSettings(path)).toEqual(Result.fail(new ProfilePathUnsafe({ path })))
    }
  })
})
