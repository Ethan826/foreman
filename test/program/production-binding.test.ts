// The target binding through the production composition (batch review
// B04, and B09 for the ledger): at first use tarlatan records the project
// id, the owner's checkout, the supervisor worktree's path and branch
// name, the ledger and the attribute allowance, canonical, in the state
// directory. A configuration that later names the same state directory
// with any of these changed is refused before any store, launch or git
// command, while `status` and `session close` stay reachable and act on
// the recorded target.
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { git, makeRepo } from "../runtime/git-repo.ts"
import {
  cli,
  configOf,
  endToEndMillis,
  failureTag,
  type Layout,
  openedSession,
  recorded,
  succeeded,
  withLayout,
  writeConfig,
} from "./production-harness.ts"

/** One change to the configuration, made in a copy that keeps the state directory. */
type Change = (layout: Layout) => Effect.Effect<Record<string, unknown>, unknown>

const otherTarget: Change = (layout) =>
  Effect.as(makeRepo(layout.root, "owner2"), configOf(layout, { ownerCheckout: `${layout.root}/owner2` }))

const otherSupervisorPath: Change = (layout) =>
  Effect.succeed(configOf(layout, { supervisor: { path: `${layout.root}/elsewhere`, name: "t" } }))

const otherSupervisorName: Change = (layout) =>
  Effect.succeed(configOf(layout, { supervisor: { path: layout.supervisor, name: "u" } }))

const otherProject: Change = (layout) => Effect.succeed(configOf(layout, { projectId: "beta" }))

const otherPolicy: Change = (layout) =>
  Effect.succeed(configOf(layout, { attributeAllowance: { rootLines: ["*.wxw linguist-language=Rust"] } }))

const otherLedger: Change = (layout) =>
  Effect.sync(() => {
    mkdirSync(`${layout.root}/ledger2`)
    return configOf(layout, { ledgerDir: `${layout.root}/ledger2` })
  })

/** The commands that act on the target, each refused under a mismatch. */
const targetCommands: ReadonlyArray<ReadonlyArray<string>> = [
  ["worktree", "create"],
  ["implement", "--waive"],
  ["review", "--waive", "--attest"],
  ["session", "close", "--finished", "--attest"],
]

const refusedAfterChange = (change: Change) => () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* openedSession(layout)
      yield* succeeded(layout, ["implement", "--waive"])
      const copied = writeConfig(layout, yield* change(layout), `${layout.root}/copied.json`)
      for (const words of targetCommands) {
        const run = yield* cli(layout, words, { config: copied })
        expect([words.join(" "), run.status, failureTag(run)]).toEqual([words.join(" "), 1, "TargetMismatch"])
      }
      expect([recorded(layout, "claude-launches"), recorded(layout, "codex-launches")]).toEqual(["ran\n", undefined])
      yield* succeeded(layout, ["status"], { config: copied })
      yield* succeeded(layout, ["session", "close", "--abandoned"], { config: copied })
      expect(existsSync(`${layout.root}/ledger2/ledger.sqlite`)).toBe(false)
      expect(existsSync(`${layout.root}/elsewhere`)).toBe(false)
      expect(yield* git(layout.owner, "branch", "--list", "tarlatan/u")).toBe("")
    }),
  )

const otherTargetUntouched = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* openedSession(layout)
      const copied = writeConfig(layout, yield* otherTarget(layout), `${layout.root}/copied.json`)
      const run = yield* cli(layout, ["worktree", "create"], { config: copied })
      expect(failureTag(run)).toBe("TargetMismatch")
      const listing = yield* git(`${layout.root}/owner2`, "worktree", "list", "--porcelain")
      expect(listing.split("\n").filter((line) => line.startsWith("worktree "))).toEqual([`worktree ${layout.root}/owner2`])
      expect(yield* git(`${layout.root}/owner2`, "branch", "--list", "tarlatan/*")).toBe("")
    }),
  )

const recordedAtFirstUse = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* succeeded(layout, ["worktree", "create"])
      expect(JSON.parse(readFileSync(`${layout.state}/target-binding.json`, "utf8"))).toEqual({
        projectId: "alpha",
        ownerCheckout: layout.owner,
        supervisor: { path: layout.supervisor, name: "t" },
        ledger: `${layout.ledgerDir}/ledger.sqlite`,
        attributeAllowance: { rootLines: [] },
      })
    }),
  )

const samePathsThroughLinks = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* openedSession(layout)
      symlinkSync(layout.owner, `${layout.root}/owner-link`)
      symlinkSync(layout.ledgerDir, `${layout.root}/ledger-link`)
      const linked = configOf(layout, { ownerCheckout: `${layout.root}/owner-link`, ledgerDir: `${layout.root}/ledger-link` })
      yield* succeeded(layout, ["implement", "--waive"], { config: writeConfig(layout, linked, `${layout.root}/linked.json`) })
    }),
  )

const checkCommandsNotBound = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* openedSession(layout)
      const binding = readFileSync(`${layout.state}/target-binding.json`, "utf8")
      const copied = writeConfig(layout, configOf(layout, { checkCommands: ["bun run verify"] }), `${layout.root}/copied.json`)
      yield* succeeded(layout, ["implement", "--waive"], { config: copied })
      expect(recorded(layout, "claude-launches")).toBe("ran\n")
      expect(readFileSync(`${layout.state}/target-binding.json`, "utf8")).toBe(binding)
      expect(binding).not.toContain("checkCommands")
    }),
  )

const damagedBindingKept = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* openedSession(layout)
      writeFileSync(`${layout.state}/target-binding.json`, "{}")
      const run = yield* cli(layout, ["implement", "--waive"])
      expect([run.status, failureTag(run)]).toEqual([1, "TargetBindingUnreadable"])
      expect(readFileSync(`${layout.state}/target-binding.json`, "utf8")).toBe("{}")
      expect(recorded(layout, "claude-launches")).toBeUndefined()
    }),
  )

describe("the target binding in production", () => {
  it.effect("is recorded, canonical, at first use", recordedAtFirstUse, endToEndMillis)
  it.effect("a copied config with another owner's checkout is refused", refusedAfterChange(otherTarget), endToEndMillis)
  it.effect("a copied config with another supervisor path is refused", refusedAfterChange(otherSupervisorPath), endToEndMillis)
  it.effect("a copied config with another branch name is refused", refusedAfterChange(otherSupervisorName), endToEndMillis)
  it.effect("a copied config with another project id is refused", refusedAfterChange(otherProject), endToEndMillis)
  it.effect("a copied config with another attribute policy is refused", refusedAfterChange(otherPolicy), endToEndMillis)
  it.effect("a copied config with another ledger is refused, and that ledger is never opened", refusedAfterChange(otherLedger), endToEndMillis)
  it.effect("the other owner's repository is left alone", otherTargetUntouched, endToEndMillis)
  it.effect("the same paths named through links are the same target", samePathsThroughLinks, endToEndMillis)
  it.effect("a damaged binding is refused and kept as it is", damagedBindingKept, endToEndMillis)
  it.effect("a copied config with other check commands is the same target (dogfood-3b)", checkCommandsNotBound, endToEndMillis)
})
