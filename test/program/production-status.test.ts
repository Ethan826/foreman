// `status` through the production composition under the owner's
// requirements B11 and B04 together: it creates nothing, writes nothing
// and stays reachable when the configuration names another target. It
// reports the state directory's target binding (a mismatch is shown, not
// refused) and git's private HOME as B02 judges it. It never makes that
// HOME: when the HOME is missing or fails B02's checks, status says so and
// skips the git-based worktree check instead of running git with it.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Effect, Option, Schema } from "effect"
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { StoreVersionNewer } from "../../src/domain/store-version.ts"
import { ledgerTaken } from "../../src/program/production-status.ts"
import { openLedgerReader } from "../../src/runtime/state-read.ts"
import { rawExec, setVersion, versionOf } from "../runtime/store-version-fixtures.ts"
import {
  configOf,
  endToEndMillis,
  type Layout,
  ledgerPath,
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

/** The store versions status printed, kept as printed so a missing key stays missing. */
const ShownStoreVersions = Schema.fromJsonString(Schema.Struct({ storeVersions: Schema.Unknown }))

/** The `storeVersions` `status` printed for the layout's own configuration. */
const shownStoreVersions = (layout: Layout) =>
  Effect.map(
    Effect.flatMap(succeeded(layout, ["status"]), (run) =>
      Schema.decodeUnknownEffect(ShownStoreVersions)(Arr.join(run.out, "\n")),
    ),
    (shown) => shown.storeVersions,
  )

const logOf = (layout: Layout) => `${layout.state}/log.sqlite`

// A log at 1 beside a ledger at 0, which only a raw value can show: a
// stamped ledger would read 1.
const rawVersionsShown = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* openedSession(layout)
      yield* setVersion(ledgerPath(layout), 0)
      expect(yield* versionOf(logOf(layout))).toBe(1)
      expect(yield* shownStoreVersions(layout)).toStrictEqual({ log: 1, ledger: 0 })
      expect(yield* versionOf(ledgerPath(layout))).toBe(0)
    }),
  )

/** The store versions and the findings status printed, kept as printed. */
const ShownVersionsAndFindings = Schema.fromJsonString(
  Schema.Struct({ storeVersions: Schema.Unknown, findings: Schema.Array(Schema.Unknown) }),
)

/** The `storeVersions` and `findings` `status` printed for the layout's own configuration. */
const shownVersionsAndFindings = (layout: Layout) =>
  Effect.flatMap(succeeded(layout, ["status"]), (run) =>
    Schema.decodeUnknownEffect(ShownVersionsAndFindings)(Arr.join(run.out, "\n")),
  )

// v0.2.0 (dogfood-6): a log at 1, not yet raised, and a log at 2 are both
// read; status shows each raw value and gives no finding for either.
const logAtOneAndTwoShown = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* openedSession(layout)
      expect(yield* versionOf(logOf(layout))).toBe(1)
      expect(yield* shownVersionsAndFindings(layout)).toStrictEqual({
        storeVersions: { log: 1, ledger: 1 },
        findings: [],
      })
      yield* setVersion(logOf(layout), 2)
      expect(yield* shownVersionsAndFindings(layout)).toStrictEqual({
        storeVersions: { log: 2, ledger: 1 },
        findings: [],
      })
      expect(yield* versionOf(logOf(layout))).toBe(2)
    }),
  )

const noTargetOmitsLedger = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* openedSession(layout)
      writeFileSync(`${layout.state}/target-binding.json`, "{ damaged")
      expect(yield* shownStoreVersions(layout)).toStrictEqual({ log: 1 })
    }),
  )

const noLedgerFileOmitsLedger = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* openedSession(layout)
      Arr.forEach(readdirSync(layout.ledgerDir), (name) => {
        rmSync(`${layout.ledgerDir}/${name}`, { recursive: false, force: false })
      })
      expect(yield* shownStoreVersions(layout)).toStrictEqual({ log: 1 })
    }),
  )

/** How long the test's ledger reader waits for a lock, in milliseconds. */
const readerBusyMillis = 1_000

/**
 * Review finding F6, one level below `main`: production status opens and
 * reads the ledger in one call, so no seam lets a test stamp between the
 * two. Here the ledger is opened at 1, another connection stamps it 2 and
 * adds a row that would not decode, and the read's snapshot goes through
 * `ledgerTaken`, the function status turns a ledger read into its finding
 * with. A read that decided on the open's version would read the bad row.
 */
const stampedBetweenOpenAndRead = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* openedSession(layout)
      const path = ledgerPath(layout)
      const taken = yield* Effect.scoped(
        Effect.gen(function* () {
          const reader = yield* Effect.flatMap(openLedgerReader(path, readerBusyMillis), Effect.fromOption)
          yield* rawExec(path, "INSERT INTO readings (seq, body, grantId) VALUES (99, 'not a row', NULL)")
          yield* setVersion(path, 2)
          return ledgerTaken(path)(yield* reader.snapshot)
        }),
      )
      expect(taken.finding).toEqual(Option.some(new StoreVersionNewer({ path, found: 2, known: 1 })))
      expect(taken.version).toEqual(Option.some(2))
      expect(taken.rows).toEqual(Option.none())
    }),
  )

describe("status in production: a ledger stamped between its open and its read (review finding F6)", () => {
  it.effect("gives P6's finding, the version found and no rows", stampedBetweenOpenAndRead, endToEndMillis)
})

describe("status in production: store format versions (dogfood-5)", () => {
  it.effect("shows the log's and the ledger's versions as read, and stamps neither", rawVersionsShown, endToEndMillis)
  it.effect("shows a log at 1 and a log at 2 as read, with no finding (dogfood-6)", logAtOneAndTwoShown, endToEndMillis)
  it.effect("shows no ledger version when no target is in force", noTargetOmitsLedger, endToEndMillis)
  it.effect("shows no ledger version when no ledger file is found", noLedgerFileOmitsLedger, endToEndMillis)
})

describe("status in production", () => {
  it.effect("lists the configured check commands, in order (dogfood-3b)", checkCommandsListed, endToEndMillis)
  it.effect("reports a missing git HOME, makes none and skips the worktree check", missingHomeReported, endToEndMillis)
  it.effect("reports a git HOME that fails the checks and leaves it as it is", unusableHomeLeftAlone, endToEndMillis)
  it.effect("runs the worktree check with a usable git HOME", usableHomeChecked, endToEndMillis)
  it.effect("reports a mismatched configuration, runs on the recorded target and creates nothing", mismatchReported, endToEndMillis)
})
