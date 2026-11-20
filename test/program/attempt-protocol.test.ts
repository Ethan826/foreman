// The launch protocol for `implement` (plan "Write protocol", steps 1 and
// 3 to 8, and "Slice A1", attempt-protocol): the exact order of writes
// with a fake client, then every case of the waiver step under refusing
// pacing. Real log, ledger and lock; no real client.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Effect, Option, Schema } from "effect"
import { readFileSync } from "node:fs"
import { Clients } from "../../src/domain/clients.ts"
import { Finished, HoldCreated, type ProjectEvent, ReportRecorded, Waived } from "../../src/domain/events.ts"
import { Quota } from "../../src/domain/holds.ts"
import { LedgerSeq, WaiverId } from "../../src/domain/ids.ts"
import { Grant } from "../../src/domain/ledger.ts"
import { Success } from "../../src/domain/outcomes.ts"
import { claudeEditingArgv } from "../../src/domain/profiles.ts"
import { Roles } from "../../src/domain/roles.ts"
import { implementBrief } from "../../src/format/brief.ts"
import { implement } from "../../src/program/implement.ts"
import { CommandRefused, QuotaHeld, WaiverRefused } from "../../src/program/session-errors.ts"
import { sha256Of } from "../../src/runtime/state-files.ts"
import { Windows } from "../../src/domain/window.ts"
import { claudeSuccess } from "../fixtures/clients/claude-success.ts"
import {
  eventsOf,
  type Harness,
  head,
  ledgerRows,
  logBatch,
  nowMono,
  published,
  reading,
  rowsOf,
  started,
  withHarness,
} from "./session-harness.ts"
import { append, failsWith, failureHold, intendedOf, opened, quotaHold, waivedOf } from "./session-steps.ts"

const exactSequence = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    const recorded = yield* implement(harness.context, { waive: false })
    expect(recorded.outcome).toEqual(new Success())
    expect(harness.trace).toMatchObject([
      ledgerRows("Grant"),
      logBatch("Intended"),
      started,
      logBatch("Launched"),
      published("raw.jsonl"),
      published("handoff.md"),
      logBatch("Finished", "ReportRecorded"),
      ledgerRows("Charged"),
    ])
    const [intent] = yield* intendedOf(harness)
    expect(intent).toMatchObject({
      step: { role: Roles.Implementer, round: 0 },
      baseRevision: head,
      client: Clients.Claude,
      waiverId: Option.none(),
    })
    const grants = Arr.filter(yield* rowsOf(harness), Schema.is(Grant))
    expect(Arr.map(grants, (grant) => grant.grantId)).toEqual([intent?.grantId])
  })

const launchesWithProfile = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    yield* implement(harness.context, { waive: false })
    const [launch] = harness.client.launches
    const settingsFile = `${harness.dir}/claude-settings.json`
    expect(launch?.argv).toEqual(claudeEditingArgv({ brief: implementBrief({ task: "Add a greeting.\n" }), settingsFile }))
    expect(launch?.cwd).toBe(harness.worktree.path)
    expect(launch?.env).toEqual({ PATH: "/usr/bin", HOME: "/home/owner" })
    expect(harness.shown).toEqual(claudeSuccess.lines)
  })

const recordsReportFiles = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    yield* implement(harness.context, { waive: false })
    const events = yield* eventsOf(harness)
    const [report] = Arr.filter(events, Schema.is(ReportRecorded))
    const [finish] = Arr.filter(events, Schema.is(Finished))
    expect(finish?.outcome).toEqual(new Success())
    expect(report?.role).toBe(Roles.Implementer)
    expect(sha256Of(readFileSync(report?.rawPath ?? ""))).toBe(report?.rawSha256)
    expect(sha256Of(readFileSync(report?.handoffPath ?? ""))).toBe(report?.handoffSha256)
    expect(readFileSync(report?.rawPath ?? "", "utf8")).toContain('"subtype": "success"')
    expect(readFileSync(report?.handoffPath ?? "", "utf8")).toBe("Done.")
  })

const freshWaive = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    const recorded = yield* implement(harness.context, { waive: true })
    expect(harness.trace).toMatchObject([
      logBatch("HoldCreated"),
      logBatch("Waived"),
      ledgerRows("Grant"),
      logBatch("Intended"),
      started,
      logBatch("Launched"),
      published("raw.jsonl"),
      published("handoff.md"),
      logBatch("Finished", "ReportRecorded"),
      ledgerRows("Charged"),
    ])
    const [waived] = yield* waivedOf(harness)
    const [intent] = yield* intendedOf(harness)
    expect(waived?.provider).toBe(Clients.Claude)
    expect(intent?.waiverId).toEqual(Option.some(waived?.waiverId))
    expect(recorded.outcome).toEqual(new Success())
  })

const withoutWaive = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    failsWith(yield* Effect.exit(implement(harness.context, { waive: false })), Schema.is(QuotaHeld))
    expect(harness.trace).toMatchObject([logBatch("HoldCreated")])
    const hold = Arr.filter(yield* eventsOf(harness), Schema.is(HoldCreated))
    expect(hold).toMatchObject([
      { hold: { provider: Clients.Claude, windows: [Windows.FiveHour, Windows.Weekly], heldMono: Option.none() } },
    ])
    harness.trace.length = 0
    failsWith(yield* Effect.exit(implement(harness.context, { waive: false })), Schema.is(QuotaHeld))
    expect(harness.trace).toEqual([])
    expect(harness.client.launches).toEqual([])
  })

const retryWaiveAfterQ = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    yield* Effect.exit(implement(harness.context, { waive: false }))
    harness.trace.length = 0
    yield* implement(harness.context, { waive: true })
    expect(harness.trace.slice(0, 3)).toMatchObject([logBatch("Waived"), ledgerRows("Grant"), logBatch("Intended")])
    expect(Arr.filter(yield* eventsOf(harness), Schema.is(HoldCreated)).length).toBe(1)
  })

const retryAfterW = (waive: boolean) => (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    yield* append(harness, [quotaHold(Clients.Claude), new Waived({ provider: Clients.Claude, waiverId: WaiverId.make("w-armed") })])
    yield* implement(harness.context, { waive })
    expect(harness.trace.slice(0, 2)).toMatchObject([ledgerRows("Grant"), logBatch("Intended")])
    expect((yield* waivedOf(harness)).length).toBe(1)
    const [intent] = yield* intendedOf(harness)
    expect(intent?.waiverId).toEqual(Option.some(WaiverId.make("w-armed")))
  })

const refusedNothingAppended = (
  setup: ReadonlyArray<ProjectEvent>,
  guard: (error: unknown) => boolean,
) => (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    yield* append(harness, setup)
    const before = yield* eventsOf(harness)
    failsWith(yield* Effect.exit(implement(harness.context, { waive: true })), guard)
    expect(yield* eventsOf(harness)).toEqual(before)
    expect(harness.trace).toEqual([])
    expect(harness.client.launches).toEqual([])
  })

const otherWaiverOnlyBatchQ = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    yield* append(harness, [new Waived({ provider: Clients.Codex, waiverId: WaiverId.make("w-codex") })])
    failsWith(yield* Effect.exit(implement(harness.context, { waive: true })), Schema.is(WaiverRefused))
    expect(harness.trace).toMatchObject([logBatch("HoldCreated"), logBatch("WaiverExpired")])
    expect(harness.client.launches).toEqual([])
  })

const otherWaiverExpiredOnly = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    yield* append(harness, [new Waived({ provider: Clients.Codex, waiverId: WaiverId.make("w-codex") }), quotaHold(Clients.Claude)])
    failsWith(yield* Effect.exit(implement(harness.context, { waive: true })), Schema.is(WaiverRefused))
    expect(harness.trace).toMatchObject([logBatch("WaiverExpired")])
    expect(harness.client.launches).toEqual([])
  })

const heldAt = (windows: ReadonlyArray<(typeof Windows)[keyof typeof Windows]>) =>
  new HoldCreated({
    hold: new Quota({
      provider: Clients.Claude,
      windows,
      heldMono: Option.some({ ...nowMono, micros: 0 }),
      ledgerSeq: LedgerSeq.make(2),
    }),
  })

const releasedByReadings = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    yield* append(harness, [heldAt([Windows.FiveHour, Windows.Weekly])])
    yield* harness.rawLedger.transact((tx) => tx.append([reading(Windows.FiveHour), reading(Windows.Weekly)]))
    const recorded = yield* implement(harness.context, { waive: false })
    expect(recorded.outcome).toEqual(new Success())
    expect(harness.trace.slice(0, 2)).toMatchObject([ledgerRows("Grant"), logBatch("Intended")])
    expect((yield* waivedOf(harness)).length).toBe(0)
  })

const notReleasedWithoutWindows = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    yield* append(harness, [heldAt([])])
    yield* harness.rawLedger.transact((tx) => tx.append([reading(Windows.FiveHour), reading(Windows.Weekly)]))
    failsWith(yield* Effect.exit(implement(harness.context, { waive: false })), Schema.is(QuotaHeld))
    expect(harness.trace).toEqual([])
  })

describe("implement: the write protocol", () => {
  it.effect("settles, grants, appends I, launches, appends L, publishes, appends F, settles", () =>
    withHarness({}, exactSequence),
  )
  it.effect("launches the editing profile in the worktree without GIT_* variables", () =>
    withHarness({}, launchesWithProfile),
  )
  it.effect("records report files whose hashes match", () => withHarness({}, recordsReportFiles))
})

describe("implement: the waiver step under refusing pacing", () => {
  it.effect("a fresh --waive writes Q, then W, then the grant, then I naming the waiver", () =>
    withHarness({ allowing: false }, freshWaive),
  )
  it.effect("without --waive writes Q only, and a second run appends nothing", () =>
    withHarness({ allowing: false }, withoutWaive),
  )
  it.effect("a retry with --waive after Q writes no second hold, then W, grant and I", () =>
    withHarness({ allowing: false }, retryWaiveAfterQ),
  )
  it.effect("a retry after W with --waive writes no second Waived and uses the armed waiver", () =>
    withHarness({ allowing: false }, retryAfterW(true)),
  )
  it.effect("a retry after W without --waive writes no second Waived and uses the armed waiver", () =>
    withHarness({ allowing: false }, retryAfterW(false)),
  )
  it.effect("a non-quota hold refuses and appends nothing", () =>
    withHarness({ allowing: false }, refusedNothingAppended([failureHold], Schema.is(CommandRefused))),
  )
  it.effect("a Claude quota hold with Codex's armed waiver refuses --waive and only expires that waiver", () =>
    withHarness({ allowing: false }, otherWaiverExpiredOnly),
  )
  it.effect("Codex's armed waiver with no Claude hold writes batch Q, refuses --waive, then expires it", () =>
    withHarness({ allowing: false }, otherWaiverOnlyBatchQ),
  )
  it.effect("a quota hold released by post-hold readings is treated as absent", () =>
    withHarness({ allowing: true }, releasedByReadings),
  )
  it.effect("a quota hold naming no window stays in place despite readings", () =>
    withHarness({ allowing: true }, notReleasedWithoutWindows),
  )
})
