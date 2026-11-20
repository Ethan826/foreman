// The ledger through the production composition. It lives at
// `<ledgerDir>/ledger.sqlite`, one per owner and account, shared by every
// project's state directory, with `~/.foreman` as the default directory
// (batch review B09; design "Where the ledger lives"); each project keeps
// its own log and lock. Every role's grant estimate is the policy's
// 15-point `initialEstimate`, and the configuration cannot override it
// (batch review B10; decision P5). The
// default policy has no Codex window, so the review's grant reserves in
// none.
import { describe, expect, it } from "@effect/vitest"
import { Effect, Record, Schema } from "effect"
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { Roles } from "../../src/domain/roles.ts"
import { Grant } from "../../src/domain/ledger.ts"
import {
  cli,
  configOf,
  failureTag,
  ledgerPath,
  ledgerRowsAt,
  type Layout,
  openedSession,
  succeeded,
  withLayout,
  writeConfig,
  endToEndMillis,
} from "./production-harness.ts"

/** A review that asks for one change, so `correct` may follow. */
const oneFinding =
  'One problem.\n\n```json\n[{"id": "F1", "severity": "major", "file": "a.txt", "summary": "Wrong."}]\n```\n'

/** The points of every grant in the ledger, per grant. */
const grantPoints = (layout: Layout) =>
  Effect.map(ledgerRowsAt(ledgerPath(layout)), (rows) =>
    rows.filter(Schema.is(Grant)).map((grant) => grant.points.map((each) => each.points)),
  )

const everyRoleAtFifteen = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* openedSession(layout)
      yield* succeeded(layout, ["implement", "--waive"])
      yield* succeeded(layout, ["review", "--waive", "--attest"], { env: { FAKE_MESSAGE: oneFinding } })
      const findings = `${layout.root}/findings.md`
      writeFileSync(findings, "Fix it.\n")
      yield* succeeded(layout, ["correct", "--findings", findings, "--waive", "--attest"])
      expect(yield* grantPoints(layout)).toEqual([[15, 15], [], [15, 15]])
    }),
  )

const estimatesRefused = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      const estimates = { [Roles.Implementer]: 0, [Roles.Reviewer]: 0, [Roles.Corrector]: 0 }
      writeConfig(layout, configOf(layout, { estimates }))
      const run = yield* cli(layout, ["worktree", "create"])
      expect([run.status, failureTag(run)]).toEqual([1, "ConfigUndecodable"])
    }),
  )

/** A second project over the same owner and ledger: its own state directory, worktree and branch. */
const secondProject = (layout: Layout) => {
  mkdirSync(`${layout.root}/state-b`)
  return writeConfig(
    layout,
    configOf(layout, {
      projectId: "beta",
      stateDir: `${layout.root}/state-b`,
      supervisor: { path: `${layout.root}/supervisor-b`, name: "b" },
    }),
    `${layout.root}/config-b.json`,
  )
}

/** The project of every grant in the ledger, in seq order. */
const grantProjects = (layout: Layout) =>
  Effect.map(ledgerRowsAt(ledgerPath(layout)), (rows) => rows.filter(Schema.is(Grant)).map((grant) => grant.project))

const sharedLedger = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      const config = secondProject(layout)
      yield* openedSession(layout)
      yield* openedSession(layout, { config })
      yield* succeeded(layout, ["implement", "--waive"])
      yield* succeeded(layout, ["implement", "--waive"], { config })
      expect(yield* grantProjects(layout)).toEqual(["alpha", "beta"])
      expect(readdirSync(layout.state).filter(isStore).sort()).toEqual(["lock.sqlite", "log.sqlite"])
      expect(readdirSync(`${layout.root}/state-b`).filter(isStore).sort()).toEqual(["lock.sqlite", "log.sqlite"])
    }),
  )

/** Whether a state directory entry is one of the SQLite stores. */
const isStore = (name: string) => name.endsWith(".sqlite")

const defaultLedgerDir = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      const home = `${layout.root}/home`
      mkdirSync(home)
      mkdirSync(`${home}/.foreman`)
      writeConfig(layout, Record.remove(configOf(layout), "ledgerDir"))
      yield* openedSession(layout, { env: { HOME: home } })
      yield* succeeded(layout, ["implement", "--waive"], { env: { HOME: home } })
      expect(yield* Effect.map(ledgerRowsAt(`${home}/.foreman/ledger.sqlite`), (rows) => rows.filter(Schema.is(Grant)).length)).toBe(1)
      expect(existsSync(ledgerPath(layout))).toBe(false)
    }),
  )

describe("the shared ledger in production", () => {
  it.effect("two projects' state directories share one ledger and keep their own log and lock", sharedLedger, endToEndMillis)
  it.effect("without ledgerDir, the ledger is ~/.foreman/ledger.sqlite", defaultLedgerDir, endToEndMillis)
})

describe("grant estimates in production", () => {
  it.effect("implement and correct reserve 15 points in each Claude window; review in none", everyRoleAtFifteen, endToEndMillis)
  it.effect("a configuration naming estimates is refused", estimatesRefused, endToEndMillis)
})
