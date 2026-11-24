// Shared fixtures for the admission and grant lifecycle tests (plan Task
// B3; design "Admission rule", "Grant lifecycle"): the admission context,
// a request builder, a disposable real ledger file, and the helpers that
// seed usage readings and read the ledger's rows back.
import { Array as Arr, Effect, Option } from "effect"
import type { Scope } from "effect"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { type Client, Clients } from "../../src/domain/clients.ts"
import { BootId } from "../../src/domain/clock.ts"
import { GrantId, OpId, ProjectId, WaiverId } from "../../src/domain/ids.ts"
import { type LedgerStore, ReadingRow } from "../../src/domain/ledger.ts"
import { defaultPolicy } from "../../src/domain/policy.ts"
import { Windows } from "../../src/domain/window.ts"
import { ownerOnly } from "../../src/features/counting.ts"
import { type AdmissionRequest, allocationsInFallback } from "../../src/features/admission.ts"
import { openLedger } from "../../src/runtime/ledger-sqlite.ts"

const busyMillis = 50
const boot = BootId.make("boot-a")
const minuteMicros = 60_000_000
/** The wall-clock time every request and reading uses, in milliseconds. */
export const now = 1_000_000
const nowMono = { bootId: boot, micros: 30 * minuteMicros }
/** The admission context: the default policy, owner-only retirement and fallback allocations. */
export const context = {
  policy: defaultPolicy,
  retirement: ownerOnly,
  allocations: allocationsInFallback,
}
/** The estimate every request carries: 15 points in each of the five-hour and weekly windows. */
export const estimate = [
  { window: Windows.FiveHour, points: 15 },
  { window: Windows.Weekly, points: 15 },
]
/** A Claude request numbered `n` (`op-n`, `g-n`), with an optional waiver armed for `waiverProvider`. */
export const request = (
  n: number,
  project = "alpha",
  waiver = false,
  waiverProvider: Client = Clients.Claude,
): AdmissionRequest => ({
  project: ProjectId.make(project),
  opId: OpId.make(`op-${String(n)}`),
  grantId: GrantId.make(`g-${String(n)}`),
  provider: Clients.Claude,
  estimate,
  now,
  nowMono: Option.some(nowMono),
  waiver: waiver ? Option.some({ waiverId: WaiverId.make("w-1"), provider: waiverProvider }) : Option.none(),
})
/** A Claude usage reading of `usedPercent` in `window`, observed at `now` (a minute early by the monotonic clock). */
export const readingRow = (window: (typeof Windows)[keyof typeof Windows], usedPercent: number) =>
  new ReadingRow({
    provider: Clients.Claude,
    window,
    usedPercent,
    resetsAt: Option.some(now + 3_600_000),
    observedAt: now,
    observedMono: Option.some({ bootId: boot, micros: 29 * minuteMicros }),
    source: "claudeRateLimitEvent",
  })

/** Removes `dir` and everything under it. */
export const removeDir = (dir: string) =>
  Effect.sync(() => {
    rmSync(dir, { recursive: true, force: true })
  })
/** Runs `use` against a fresh ledger file in a temporary directory, removed afterward. */
export const withLedger = <A, E>(
  use: (store: LedgerStore, path: string) => Effect.Effect<A, E, Scope.Scope>,
) => {
  const dir = mkdtempSync(`${tmpdir()}/tarlatan-admit-`)
  const path = `${dir}/ledger.sqlite`
  return Effect.ensuring(
    Effect.scoped(Effect.flatMap(openLedger(path, busyMillis), (store) => use(store, path))),
    removeDir(dir),
  )
}
/** Every row in the ledger, in append order. */
export const rowsOf = (store: LedgerStore) =>
  store.transact((tx) => Effect.map(tx.read, (s) => Arr.map(s.entries, (e) => e.row)))
/** Appends readings of `fiveHour` percent in the five-hour window and 0 in the weekly one. */
export const seedReadings = (store: LedgerStore, fiveHour: number) =>
  store.transact((tx) => tx.append([readingRow(Windows.FiveHour, fiveHour), readingRow(Windows.Weekly, 0)]))
