// Review finding F7: generated histories of the grant lifecycle run
// through the real SQLite ledger. Each run opens a ledger in a temporary
// directory and interprets a generated sequence of admits, Intended and
// Finished appends to each project's in-memory log, lost-race cancels,
// crashes and settles. A crash drops what live processes had not yet
// written: an admitted step never writes its Intended, and an intended
// step never writes its Finished. The assertions are invariants over the
// stored rows; none of them recomputes what a settle should write. A
// settle of one project writes no settlement row for another's grant.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Effect, Match, Option, Schema } from "effect"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { Clients } from "../../src/domain/clients.ts"
import { BootId } from "../../src/domain/clock.ts"
import { Finished, Intended, type ProjectEvent } from "../../src/domain/events.ts"
import { GrantId, OpId, ProjectId, Revision, TrancheId } from "../../src/domain/ids.ts"
import { Charged, Grant, GrantCanceled, type LedgerRow, type LedgerStore, ReadingRow } from "../../src/domain/ledger.ts"
import { Success } from "../../src/domain/outcomes.ts"
import { defaultPolicy } from "../../src/domain/policy.ts"
import { Roles } from "../../src/domain/roles.ts"
import { Windows } from "../../src/domain/window.ts"
import { allocationsInFallback } from "../../src/features/admission.ts"
import { ownerOnly } from "../../src/features/counting.ts"
import { admit, Admitted, applySettle, cancelLostRace } from "../../src/program/admission.ts"
import { openLedger } from "../../src/runtime/ledger-sqlite.ts"

const busyMillis = 50
const now = 1_000_000
const minuteMicros = 60_000_000
const boot = BootId.make("boot-a")
const projects = ["alpha", "beta"] as const
const context = { policy: defaultPolicy, retirement: ownerOnly, allocations: allocationsInFallback }
const estimate = [
  { window: Windows.FiveHour, points: 10 },
  { window: Windows.Weekly, points: 10 },
]

const Step = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 4 }))
const Project = Schema.Literals(projects)
const Op = Schema.Union([
  Schema.TaggedStruct("Admit", { n: Step, project: Project }),
  Schema.TaggedStruct("Intend", { n: Step }),
  Schema.TaggedStruct("Finish", { n: Step }),
  Schema.TaggedStruct("LoseRace", { n: Step }),
  Schema.TaggedStruct("Crash", {}),
  Schema.TaggedStruct("Settle", { project: Project }),
])
type Op = typeof Op.Type

const grantId = (n: number) => GrantId.make(`g-${String(n)}`)
const opId = (n: number) => OpId.make(`op-${String(n)}`)
const reading = (window: (typeof Windows)[keyof typeof Windows]) =>
  new ReadingRow({
    provider: Clients.Claude,
    window,
    usedPercent: 0,
    resetsAt: Option.some(now + 3_600_000),
    observedAt: now,
    observedMono: Option.some({ bootId: boot, micros: 29 * minuteMicros }),
    source: "claudeRateLimitEvent",
  })
const request = (n: number, project: string) => ({
  project: ProjectId.make(project),
  opId: opId(n),
  grantId: grantId(n),
  provider: Clients.Claude,
  estimate,
  now,
  nowMono: Option.some({ bootId: boot, micros: 30 * minuteMicros }),
  waiver: Option.none(),
})
const intended = (n: number) =>
  new Intended({
    opId: opId(n),
    tranche: TrancheId.make("t-1"),
    step: { role: Roles.Implementer, round: 0 },
    baseRevision: Revision.make("a".repeat(40)),
    grantId: grantId(n),
    client: Clients.Claude,
    waiverId: Option.none(),
  })
const finished = (n: number) => new Finished({ opId: opId(n), outcome: new Success(), endedAt: now })

// What the simulated processes have done: each project's log, the project
// of each admitted grant, and the writes live processes still owe.
interface World {
  readonly logs: Map<string, Array<ProjectEvent>>
  readonly projectOf: Map<number, string>
  readonly awaitingIntended: Set<number>
  readonly awaitingFinished: Set<number>
}
const emptyWorld = (): World => ({
  logs: new Map(Arr.map(projects, (p) => [p, []])),
  projectOf: new Map(),
  awaitingIntended: new Set(),
  awaitingFinished: new Set(),
})
const logOf = (world: World, project: string) => world.logs.get(project) ?? []

const rowsOf = (store: LedgerStore) =>
  store.transact((tx) => Effect.map(tx.read, (s) => Arr.map(s.entries, (e) => e.row)))
const count = (rows: ReadonlyArray<LedgerRow>, id: GrantId) => ({
  charges: Arr.length(Arr.filter(rows, (r) => Schema.is(Charged)(r) && r.grantId === id)),
  cancels: Arr.length(Arr.filter(rows, (r) => Schema.is(GrantCanceled)(r) && r.grantId === id)),
})

// No grant charged twice, canceled twice, or both charged and canceled.
const settledAtMostOnce = (rows: ReadonlyArray<LedgerRow>) => {
  Arr.forEach(Arr.filter(rows, Schema.is(Grant)), (grant) => {
    const { charges, cancels } = count(rows, grant.grantId)
    expect({ grant: grant.grantId, settles: charges + cancels }).toEqual({
      grant: grant.grantId,
      settles: Math.min(charges + cancels, 1),
    })
  })
}

// Right after a settle of `project`, each of its grants left open has a
// step that was Intended and not Finished in the project's log.
const onlyInFlightLeftOpen = (rows: ReadonlyArray<LedgerRow>, log: ReadonlyArray<ProjectEvent>, project: string) => {
  Arr.forEach(
    Arr.filter(rows, (r) => Schema.is(Grant)(r) && r.project === project),
    (grant) => {
      if (!Schema.is(Grant)(grant)) return
      const { charges, cancels } = count(rows, grant.grantId)
      if (charges + cancels > 0) return
      const wasIntended = Arr.some(log, (e) => Schema.is(Intended)(e) && e.grantId === grant.grantId)
      const wasFinished = Arr.some(log, (e) => Schema.is(Finished)(e) && e.opId === grant.opId)
      expect({ open: grant.grantId, wasIntended, wasFinished }).toEqual({
        open: grant.grantId,
        wasIntended: true,
        wasFinished: false,
      })
    },
  )
}

const admitStep = (store: LedgerStore, world: World, n: number, project: string) =>
  Effect.gen(function* () {
    if (world.projectOf.has(n)) return
    const result = yield* admit(store, request(n, project), context)
    if (!Schema.is(Admitted)(result)) return
    world.projectOf.set(n, project)
    world.awaitingIntended.add(n)
  })

// A live process writes the event it owes for step `n`, if it owes one.
const writeOwed = (world: World, owed: Set<number>, event: ProjectEvent, n: number) =>
  Effect.sync(() => {
    if (!owed.delete(n)) return
    logOf(world, world.projectOf.get(n) ?? "").push(event)
    if (Schema.is(Intended)(event)) world.awaitingFinished.add(n)
  })

const loseRace = (store: LedgerStore, world: World, n: number) =>
  world.awaitingIntended.delete(n) ? Effect.asVoid(cancelLostRace(store, grantId(n))) : Effect.void

const crash = (world: World) =>
  Effect.sync(() => {
    world.awaitingIntended.clear()
    world.awaitingFinished.clear()
  })

// The grant each Charged or GrantCanceled row among `rows` settles.
const settledGrants = (rows: ReadonlyArray<LedgerRow>) =>
  Arr.flatMap(rows, (r) => (Schema.is(Charged)(r) || Schema.is(GrantCanceled)(r) ? [r.grantId] : []))

// Project isolation: a settle of `project` writes no settlement row for a
// grant of another project. The ledger is append-only, so the rows the
// settle wrote are those after the `before` count.
const settlesOnlyItsProject = (before: number, rows: ReadonlyArray<LedgerRow>, project: string) => {
  const projectOf = new Map(Arr.flatMap(rows, (r) => (Schema.is(Grant)(r) ? [[r.grantId, r.project]] : [])))
  for (const grantId of settledGrants(rows.slice(before))) {
    expect({ settled: grantId, project: projectOf.get(grantId) }).toEqual({ settled: grantId, project })
  }
}

const settle = (store: LedgerStore, world: World, project: string) =>
  Effect.gen(function* () {
    const log = [...logOf(world, project)]
    const before = Arr.length(yield* rowsOf(store))
    yield* applySettle(store, log, ProjectId.make(project))
    const rows = yield* rowsOf(store)
    onlyInFlightLeftOpen(rows, log, project)
    settlesOnlyItsProject(before, rows, project)
  })

const step = (store: LedgerStore, world: World) => (op: Op) =>
  Match.value(op).pipe(
    Match.tagsExhaustive({
      Admit: ({ n, project }) => admitStep(store, world, n, project),
      Intend: ({ n }) => writeOwed(world, world.awaitingIntended, intended(n), n),
      Finish: ({ n }) => writeOwed(world, world.awaitingFinished, finished(n), n),
      LoseRace: ({ n }) => loseRace(store, world, n),
      Crash: () => crash(world),
      Settle: ({ project }) => settle(store, world, project),
    }),
  )

const runHistory = (ops: ReadonlyArray<Op>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => mkdtempSync(`${tmpdir()}/foreman-lifecycle-`)),
    (dir) =>
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* openLedger(`${dir}/ledger.sqlite`, busyMillis)
          yield* store.transact((tx) => tx.append([reading(Windows.FiveHour), reading(Windows.Weekly)]))
          const world = emptyWorld()
          yield* Effect.forEach(ops, step(store, world), { discard: true })
          settledAtMostOnce(yield* rowsOf(store))
        }),
      ),
    (dir) =>
      Effect.sync(() => {
        rmSync(dir, { recursive: true, force: true })
      }),
  )

describe("grant lifecycle over generated histories", () => {
  it.effect.prop(
    "settles each grant at most once and leaves open only in-flight steps after a settle",
    { ops: Schema.Array(Op).check(Schema.isMinLength(20), Schema.isMaxLength(40)) },
    ({ ops }) => runHistory(ops),
    { arbitrary: { runs: 200 } },
  )
})
