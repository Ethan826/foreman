// The log raise for the owner's rulings (v0.2.0, dogfood-6b): a log at
// format 1 is raised to 2 by the first append that holds `RulingAdded`,
// and, separately, by the first that holds `FindingOverruled`, since
// v0.1.1 decodes neither.
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
  RulingAdded,
} from "../../src/domain/events.ts"
import { OpId, RulingId } from "../../src/domain/ids.ts"
import { SessionId } from "../../src/domain/session.ts"
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

describe("project log format raise by the rulings' events", () => {
  it.effect("raises a log at 1 to 2 with the append that holds RulingAdded", () => withLogPath(raisedBy(rulingAdded)))
  it.effect("raises a log at 1 to 2 with the append that holds FindingOverruled", () =>
    withLogPath(raisedBy(findingOverruled)),
  )
})
