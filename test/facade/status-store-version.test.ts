// `tarlatan status` over a shared ledger stamped by a newer release
// (dogfood-5, owner ruling P6). Another project's newer release can stamp
// the shared ledger, so status reports it as a finding with its path and
// both versions, reads none of its rows, shows the version found and
// still exits 0; the ledger keeps every byte. The ledger holds a row that
// would not decode, so a status that read the rows and then dropped them
// would fail instead. Run through the CLI's `main`, as the owner runs it.
// PATH names no directory, so no client binary runs for the pin check.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Console, Effect, Schema } from "effect"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { Clients } from "../../src/domain/clients.ts"
import { HoldCreated, LogPosition } from "../../src/domain/events.ts"
import { Failure } from "../../src/domain/holds.ts"
import { OpId } from "../../src/domain/ids.ts"
import { Unclassified } from "../../src/domain/outcomes.ts"
import { Windows } from "../../src/domain/window.ts"
import { main } from "../../src/facade/cli.ts"
import { openLedger } from "../../src/runtime/ledger-sqlite.ts"
import { openProjectLog } from "../../src/runtime/project-log.ts"
import { capturing, endToEndMillis } from "../program/production-harness.ts"
import { reading } from "../program/session-harness.ts"
import { treeOf } from "../program/state-tree.ts"
import { rawExec, setVersion, versionOf } from "../runtime/store-version-fixtures.ts"

/** An environment in which no client binary can be found. */
const noClients = { PATH: "/nonexistent-tarlatan-path" }

/** How long the stores here wait for a lock, in milliseconds. */
const busyMillis = 50

/** Writes a configuration file whose state directory is `stateDir`, and returns its path. */
const configIn = (dir: string, stateDir: string) => {
  const path = `${dir}/tarlatan.json`
  const config = {
    projectId: "alpha",
    stateDir,
    ownerCheckout: `${dir}/owner`,
    supervisor: { path: `${dir}/supervisor`, name: "alpha" },
    ledgerDir: `${dir}/ledger`,
    attributeAllowance: { rootLines: [] },
    pins: { [Clients.Claude]: "2.1.328 (Claude Code)", [Clients.Codex]: "codex-cli 0.170.0" },
  }
  writeFileSync(path, JSON.stringify(config))
  return path
}

/**
 * A log at 1 holding a failure hold, and a ledger written by this release,
 * then given a row that would not decode and stamped 2, as a newer
 * release could leave it.
 */
const stateWithNewerLedger = (dir: string, ledger: string) =>
  Effect.gen(function* () {
    mkdirSync(`${dir}/state`)
    mkdirSync(`${dir}/ledger`)
    yield* Effect.scoped(
      Effect.gen(function* () {
        const log = yield* openProjectLog(`${dir}/state/log.sqlite`, busyMillis)
        const hold = new Failure({ opId: OpId.make("op-0"), outcome: new Unclassified() })
        yield* log.append(LogPosition.make(0), [new HoldCreated({ hold })])
        const store = yield* openLedger(ledger, busyMillis)
        yield* store.transact((tx) => tx.append([reading(Windows.FiveHour)]))
      }),
    )
    yield* rawExec(ledger, "INSERT INTO readings (seq, body, grantId) VALUES (99, 'not a row', NULL)")
    yield* setVersion(ledger, 2)
  })

/** The part of the printed report this test reads. */
const Shown = Schema.fromJsonString(
  Schema.Struct({
    findings: Schema.Array(Schema.Unknown),
    storeVersions: Schema.Unknown,
    report: Schema.Struct({ ledgerFound: Schema.Boolean }),
  }),
)

/** Runs `status` through `main` with a console that keeps what it prints. */
const statusRun = (config: string) =>
  Effect.gen(function* () {
    const out: Array<string> = []
    const err: Array<string> = []
    const status = yield* Effect.provideService(
      main(["--config", config, "status"], noClients),
      Console.Console,
      capturing(out, err),
    )
    return { status, out, err }
  })

const newerLedgerReported = (dir: string) =>
  Effect.gen(function* () {
    const ledger = `${dir}/ledger/ledger.sqlite`
    yield* stateWithNewerLedger(dir, ledger)
    const config = configIn(dir, `${dir}/state`)
    const before = treeOf(`${dir}/ledger`)
    const run = yield* statusRun(config)
    expect([run.status, run.err]).toEqual([0, []])
    const shown = yield* Schema.decodeUnknownEffect(Shown)(Arr.join(run.out, "\n"))
    expect(shown.findings).toContainEqual({ _tag: "StoreVersionNewer", path: ledger, found: 2, known: 1 })
    expect(shown.storeVersions).toStrictEqual({ log: 1, ledger: 2 })
    expect(shown.report.ledgerFound).toBe(false)
    expect(treeOf(`${dir}/ledger`)).toEqual(before)
    expect(yield* versionOf(ledger)).toBe(2)
  })

const withDirectory = <A, E, R>(use: (dir: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => realpathSync(mkdtempSync(`${tmpdir()}/tarlatan-status-version-`))),
    use,
    (dir) =>
      Effect.sync(() => {
        rmSync(dir, { recursive: true, force: true })
      }),
  )

describe("tarlatan status over a ledger stamped by a newer release", () => {
  it.live("reports it as a finding, reads none of its rows, exits 0 and leaves it as it was", () =>
    withDirectory(newerLedgerReported), endToEndMillis,
  )
})
