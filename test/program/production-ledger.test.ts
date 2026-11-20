// The ledger through the production composition (batch review B10;
// decision P5): every role's grant estimate is the policy's 15-point
// `initialEstimate`, and the configuration cannot override it. The
// default policy has no Codex window, so the review's grant reserves in
// none.
import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { writeFileSync } from "node:fs"
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

describe("grant estimates in production", () => {
  it.effect("implement and correct reserve 15 points in each Claude window; review in none", everyRoleAtFifteen, endToEndMillis)
  it.effect("a configuration naming estimates is refused", estimatesRefused, endToEndMillis)
})
