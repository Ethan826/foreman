// Claude's editing profile through the production composition (batch
// review B03; owner ruling of 2026-11-20): foreman writes the settings
// file itself, from the fixed template bound to the recorded supervisor
// worktree, publishes it in the state directory before admission, and
// launches Claude with exactly those bytes. The configuration cannot
// name a settings file. A file planted at the published path beforehand,
// empty or with the sandbox off, is replaced before the launch.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Effect } from "effect"
import { readFileSync, writeFileSync } from "node:fs"
import { git } from "../runtime/git-repo.ts"
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

/** The supervisor worktree's git directories as git reports them, which `worktree create` records. */
interface GitDirectories {
  readonly gitDir: string
  readonly commonDir: string
}

/** The layout's recorded git directories, read from the supervisor worktree. */
const gitDirectoriesOf = (layout: Layout) =>
  Effect.gen(function* () {
    const gitDir = yield* git(layout.supervisor, "rev-parse", "--absolute-git-dir")
    const commonDir = yield* git(layout.supervisor, "rev-parse", "--path-format=absolute", "--git-common-dir")
    return { gitDir, commonDir } satisfies GitDirectories
  })

/**
 * The fixed editing profile for the worktree at `worktree` with the
 * recorded git directories `directories` (design "Permissions"; L3 subset
 * template; owner ruling of 2026-11-23 for the two git directories).
 */
const expectedProfile = (worktree: string, directories: GitDirectories) => ({
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
        ...Arr.map(protectedNames, (name) => `${worktree}/${name}`),
        directories.commonDir,
        directories.gitDir,
      ],
    },
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
      expect(JSON.parse(received ?? "")).toEqual(expectedProfile(layout.supervisor, yield* gitDirectoriesOf(layout)))
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
      const directories = yield* gitDirectoriesOf(layout)
      expect(JSON.parse(recorded(layout, "claude-settings-received") ?? "")).toEqual(expectedProfile(layout.supervisor, directories))
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

/** The check commands one case configures (dogfood-3b). */
const configuredCommands = ["bun run verify", "bun run test"]

const checkCommandsReachProfileAndBrief = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      writeConfig(layout, configOf(layout, { checkCommands: configuredCommands }))
      yield* implementedOver(layout, "{}")
      const expected = expectedProfile(layout.supervisor, yield* gitDirectoriesOf(layout))
      const allow = [...expected.permissions.allow, "Bash(bun run verify)", "Bash(bun run test)"]
      const withCommands = { ...expected, permissions: { ...expected.permissions, allow } }
      expect(JSON.parse(recorded(layout, "claude-settings-received") ?? "")).toEqual(withCommands)
      expect(recorded(layout, "claude-argv")).toContain(
        "each exactly as written: `bun run verify`, `bun run test`. They run in the Bash sandbox",
      )
    }),
  )

const refusedCheckCommandFailsDecoding = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      writeConfig(layout, configOf(layout, { checkCommands: ["git log"] }))
      const run = yield* cli(layout, ["worktree", "create"])
      expect([run.status, failureTag(run)]).toEqual([1, "ConfigUndecodable"])
    }),
  )

describe("Claude's editing profile in production", () => {
  it.effect("configured check commands reach the profile and the brief alike", checkCommandsReachProfileAndBrief, endToEndMillis)
  it.effect("a refused check command fails the configuration's decoding", refusedCheckCommandFailsDecoding, endToEndMillis)
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
