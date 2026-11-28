// The log raise for the owner's rulings (v0.2.0, dogfood-6b): a log at
// format 1 is raised to 2 by the first append that holds `RulingAdded`,
// and, separately, by the first that holds `FindingOverruled`, since
// v0.1.1 decodes neither; likewise `RoundsGranted` and a `SessionClosed`
// whose close kind is `unconverged` (dogfood-7), after which v0.1.1's
// version decision refuses the log as newer instead of misreading the
// close. A close of another kind leaves the log at 1.
import { describe, expect, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import type { Scope } from "effect"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import {
  FindingOverruled,
  LedgerBound,
  LogPosition,
  type ProjectEvent,
  RoundsGranted,
  RulingAdded,
  SessionClosed,
} from "../../src/domain/events.ts"
import { OpId, RulingId } from "../../src/domain/ids.ts"
import { type CloseKind, CloseKinds, SessionId } from "../../src/domain/session.ts"
import { decideStoreVersion, StoreNewer } from "../../src/domain/store-version.ts"
import { openProjectLog } from "../../src/runtime/project-log.ts"
import { versionOf } from "./store-version-fixtures.ts"

const busyMillis = 50
const sessionId = SessionId.make("s-1")
const bound = new LedgerBound({ path: "/ledger/ledger.sqlite" })
const rulingAdded = new RulingAdded({
  sessionId,
  rulingId: RulingId.make("R1"),
  text: "Keep the greeting in English.",
  supersedes: Option.none(),
})
const findingOverruled = new FindingOverruled({
  sessionId,
  reviewOpId: OpId.make("op-2"),
  findingId: "F1",
  rulingId: RulingId.make("R1"),
  note: "Out of scope.",
})
const roundsGranted = new RoundsGranted({ sessionId, count: 1, note: "One more round." })

/** The known log version of v0.1.1, which decodes no `unconverged` close. */
const v011Known = 1

/** A `session close` of kind `how`. */
const closedAs = (how: CloseKind) => new SessionClosed({ sessionId, how, note: "closed", attests: Option.none() })

/** Runs `use` with the path of a log in a fresh temporary directory, removed afterwards. */
const withLogPath = <A, E>(use: (path: string) => Effect.Effect<A, E, Scope.Scope>) => {
  const dir = mkdtempSync(`${tmpdir()}/tarlatan-log-`)
  return Effect.ensuring(
    Effect.scoped(use(`${dir}/log.sqlite`)),
    Effect.sync(() => {
      rmSync(dir, { recursive: true, force: true })
    }),
  )
}

/** Appends `bound` and sees the log at 1, then appends `raising` alone and sees it at 2. */
const raisedBy = (raising: ProjectEvent) => (path: string) =>
  Effect.gen(function* () {
    const log = yield* openProjectLog(path, busyMillis)
    yield* log.append(LogPosition.make(0), [bound])
    expect(yield* versionOf(path)).toBe(1)
    yield* log.append(LogPosition.make(1), [raising])
    expect(yield* versionOf(path)).toBe(2)
  })

/** Raises the log at 1 with an unconverged close, then decides its version as v0.1.1 would. */
const refusedByV011AfterUnconverged = (path: string) =>
  Effect.gen(function* () {
    yield* raisedBy(closedAs(CloseKinds.Unconverged))(path)
    expect(decideStoreVersion(yield* versionOf(path), v011Known)).toEqual(new StoreNewer({ found: 2 }))
  })

/** Appends `bound` and an abandoned close to a new log, which stays at 1. */
const keptByAbandoned = (path: string) =>
  Effect.gen(function* () {
    const log = yield* openProjectLog(path, busyMillis)
    yield* log.append(LogPosition.make(0), [bound, closedAs(CloseKinds.Abandoned)])
    expect(yield* versionOf(path)).toBe(1)
  })

describe("project log format raise by the rulings' events", () => {
  it.effect("raises a log at 1 to 2 with the append that holds RulingAdded", () => withLogPath(raisedBy(rulingAdded)))
  it.effect("raises a log at 1 to 2 with the append that holds FindingOverruled", () =>
    withLogPath(raisedBy(findingOverruled)),
  )
  it.effect("raises a log at 1 to 2 with the append that holds RoundsGranted", () =>
    withLogPath(raisedBy(roundsGranted)),
  )
  it.effect("raises a log at 1 to 2 with an unconverged close, which v0.1.1's decision then refuses as newer", () =>
    withLogPath(refusedByV011AfterUnconverged),
  )
  it.effect("leaves a log at 1 with an abandoned close", () => withLogPath(keptByAbandoned))
})
