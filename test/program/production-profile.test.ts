// Claude's editing profile through the production composition (batch
// review B03; owner ruling of 2026-11-20): foreman writes the settings
// file itself, from the fixed template bound to the recorded supervisor
// worktree, publishes it in the state directory before admission, and
// launches Claude with exactly those bytes. The configuration cannot
// name a settings file. A file planted at the published path beforehand,
// empty or with the sandbox off, is replaced before the launch.
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { readFileSync, writeFileSync } from "node:fs"
import {
  cli,
  configOf,
  failureTag,
  type Layout,
  openedSession,
  recorded,
  succeeded,
  withLayout,
  writeConfig,
  endToEndMillis,
} from "./production-harness.ts"

/** The protected names the profile denies writing at the worktree's top level and below. */
const protectedNames = ["CLAUDE.md", "CLAUDE.local.md", "AGENTS.md", ".claude", ".codex", ".mcp.json", ".gitattributes", ".gitmodules"]

/** The fixed editing profile for the worktree at `worktree` (design "Permissions"; L3 subset template). */
const expectedProfile = (worktree: string) => ({
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
    filesystem: { denyWrite: [`${worktree}/.git`, ...protectedNames.map((name) => `${worktree}/${name}`)] },
    network: { allowedDomains: [] },
  },
  autoMemoryEnabled: false,
  disableClaudeAiConnectors: true,
})

/** Where foreman publishes the profile. */
const publishedPath = (layout: Layout) => `${layout.state}/claude-settings.json`

/** Opens a session, plants `planted` at the published path, and runs `implement --waive`. */
const implementedOver = (layout: Layout, planted: string) =>
  Effect.gen(function* () {
    yield* openedSession(layout)
    writeFileSync(publishedPath(layout), planted)
    yield* succeeded(layout, ["implement", "--waive"])
  })

/** The argument after `--settings` in the fake Claude's recorded argv. */
const settingsArgument = (layout: Layout) => {
  const words = (recorded(layout, "claude-argv") ?? "").split("\n")
  return words[words.indexOf("--settings") + 1]
}

const launchedWithProfile = (planted: string) => () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* implementedOver(layout, planted)
      const received = recorded(layout, "claude-settings-received")
      expect(settingsArgument(layout)).toBe(publishedPath(layout))
      expect(received).toBe(readFileSync(publishedPath(layout), "utf8"))
      expect(JSON.parse(received ?? "")).toEqual(expectedProfile(layout.supervisor))
    }),
  )

const settingsPathRefused = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      writeFileSync(`${layout.root}/settings.json`, "{}")
      writeConfig(layout, configOf(layout, { claudeSettings: `${layout.root}/settings.json` }))
      const run = yield* cli(layout, ["worktree", "create"])
      expect(run.status).toBe(1)
      expect(failureTag(run)).toBe("ConfigUndecodable")
    }),
  )

/** A review that asks for one change. */
const oneFinding =
  'One problem.\n\n```json\n[{"id": "F1", "severity": "major", "file": "a.txt", "summary": "Wrong."}]\n```\n'

const correctionUsesProfile = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* implementedOver(layout, "{}")
      yield* succeeded(layout, ["review", "--waive", "--attest"], { env: { FAKE_MESSAGE: oneFinding } })
      writeFileSync(`${layout.root}/findings.md`, "Fix it.\n")
      writeFileSync(publishedPath(layout), '{"sandbox": {"enabled": false}}')
      yield* succeeded(layout, ["correct", "--findings", `${layout.root}/findings.md`, "--waive", "--attest"])
      expect(recorded(layout, "claude-launches")).toBe("ran\nran\n")
      expect(JSON.parse(recorded(layout, "claude-settings-received") ?? "")).toEqual(expectedProfile(layout.supervisor))
    }),
  )

const refusedPublishesNothing = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* openedSession(layout)
      writeFileSync(publishedPath(layout), "{}")
      const run = yield* cli(layout, ["review", "--waive", "--attest"])
      expect(run.status).toBe(1)
      expect(readFileSync(publishedPath(layout), "utf8")).toBe("{}")
    }),
  )

describe("Claude's editing profile in production", () => {
  it.effect("the configuration cannot name a settings file", settingsPathRefused, endToEndMillis)
  it.effect("implement launches with the generated profile, replacing an empty planted file", launchedWithProfile("{}"), endToEndMillis)
  it.effect(
    "implement launches with the generated profile, replacing a planted file with the sandbox off",
    launchedWithProfile('{"sandbox": {"enabled": false}, "permissions": {"allow": ["Edit(//elsewhere/**)"]}}'),
    endToEndMillis,
  )
  it.effect("correct launches with the generated profile too", correctionUsesProfile, endToEndMillis)
  it.effect("a command the rules refuse publishes no profile", refusedPublishesNothing, endToEndMillis)
})
