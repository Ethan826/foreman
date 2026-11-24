// `status` through the production composition under the owner's
// requirements B11 and B04 together: it creates nothing, writes nothing
// and stays reachable when the configuration names another target. It
// reports the state directory's target binding (a mismatch is shown, not
// refused) and git's private HOME as B02 judges it. It never makes that
// HOME: when the HOME is missing or fails B02's checks, status says so and
// skips the git-based worktree check instead of running git with it.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Effect, Schema } from "effect"
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import {
  configOf,
  endToEndMillis,
  type Layout,
  openedSession,
  succeeded,
  withLayout,
  writeConfig,
} from "./production-harness.ts"
import { treeOf } from "./state-tree.ts"

const homeOf = (layout: Layout) => `${layout.state}/git-home`

/** The state and ledger directories as they are now, but `-shm` (owner ruling on B11; state-tree.ts). */
const stateTree = (layout: Layout) => [treeOf(layout.state), treeOf(layout.ledgerDir)]

/**
 * The part of the printed report these tests read. The binding and the
 * HOME readings stay as printed, so they are compared whole.
 */
const Shown = Schema.Struct({
  target: Schema.Unknown,
  gitHome: Schema.Unknown,
  report: Schema.Struct({
    ledgerFound: Schema.Boolean,
    worktree: Schema.Struct({ passed: Schema.Boolean, detail: Schema.String }),
  }),
})

/** Runs `status` with `config` (the layout's own by default) and decodes what it printed. */
const shownStatus = (layout: Layout, config = layout.configPath) =>
  Effect.flatMap(succeeded(layout, ["status"], { config }), (run) =>
    Schema.decodeUnknownEffect(Schema.fromJsonString(Shown))(run.out.join("\n")),
  )

const missingHomeReported = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* openedSession(layout)
      rmSync(homeOf(layout), { recursive: true, force: false })
      const before = stateTree(layout)
      const shown = yield* shownStatus(layout)
      expect(shown.gitHome).toEqual({ _tag: "GitHomeRefused", path: homeOf(layout), reasons: ["nothing is at the path"] })
      expect(shown.report.worktree.passed).toBe(false)
      expect(shown.report.worktree.detail).toContain("worktree check skipped")
      expect(existsSync(homeOf(layout))).toBe(false)
      expect(stateTree(layout)).toEqual(before)
    }),
  )

const unusableHomeLeftAlone = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* openedSession(layout)
      writeFileSync(`${homeOf(layout)}/.gitconfig`, "[user]\n\tname = planted\n")
      const before = stateTree(layout)
      const shown = yield* shownStatus(layout)
      expect(shown.gitHome).toEqual({
        _tag: "GitHomeRefused",
        path: homeOf(layout),
        reasons: ["is not empty (1 entries)"],
      })
      expect(shown.report.worktree.passed).toBe(false)
      expect(shown.report.worktree.detail).toContain("worktree check skipped")
      expect(stateTree(layout)).toEqual(before)
    }),
  )

const usableHomeChecked = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* openedSession(layout)
      const shown = yield* shownStatus(layout)
      expect(shown.gitHome).toEqual({ _tag: "GitHomeUsable", path: homeOf(layout) })
      expect(shown.report.worktree.passed).toBe(true)
      expect(shown.target).toEqual({ _tag: "TargetBound", binding: `${layout.state}/target-binding.json` })
    }),
  )

const mismatchReported = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* openedSession(layout)
      mkdirSync(`${layout.root}/ledger2`)
      const copied = writeConfig(
        layout,
        configOf(layout, { projectId: "beta", ledgerDir: `${layout.root}/ledger2` }),
        `${layout.root}/copied.json`,
      )
      const before = stateTree(layout)
      const shown = yield* shownStatus(layout, copied)
      expect(shown.target).toEqual({
        _tag: "TargetMismatch",
        binding: `${layout.state}/target-binding.json`,
        differences: [
          'projectId: recorded "alpha", configured "beta"',
          `ledger: recorded "${layout.ledgerDir}/ledger.sqlite", configured "${layout.root}/ledger2/ledger.sqlite"`,
        ],
      })
      expect(shown.report.ledgerFound).toBe(true)
      expect(shown.report.worktree.passed).toBe(true)
      expect(readdirSync(`${layout.root}/ledger2`)).toEqual([])
      expect(stateTree(layout)).toEqual(before)
    }),
  )

/** The check commands status prints. */
const ShownCheckCommands = Schema.fromJsonString(Schema.Struct({ checkCommands: Schema.Array(Schema.String) }))

/** The check commands `status` printed with the configuration at `config`. */
const shownCheckCommands = (layout: Layout, config: string) =>
  Effect.flatMap(succeeded(layout, ["status"], { config }), (run) =>
    Schema.decodeUnknownEffect(ShownCheckCommands)(Arr.join(run.out, "\n")),
  )

const checkCommandsListed = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* openedSession(layout)
      expect((yield* shownCheckCommands(layout, layout.configPath)).checkCommands).toEqual([])
      const commands = ["bun run verify", "bun run test"]
      const copied = writeConfig(layout, configOf(layout, { checkCommands: commands }), `${layout.root}/copied.json`)
      expect((yield* shownCheckCommands(layout, copied)).checkCommands).toEqual(commands)
    }),
  )

describe("status in production", () => {
  it.effect("lists the configured check commands, in order (dogfood-3b)", checkCommandsListed, endToEndMillis)
  it.effect("reports a missing git HOME, makes none and skips the worktree check", missingHomeReported, endToEndMillis)
  it.effect("reports a git HOME that fails the checks and leaves it as it is", unusableHomeLeftAlone, endToEndMillis)
  it.effect("runs the worktree check with a usable git HOME", usableHomeChecked, endToEndMillis)
  it.effect("reports a mismatched configuration, runs on the recorded target and creates nothing", mismatchReported, endToEndMillis)
})
