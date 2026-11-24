// `tarlatan worktree create` (a deviation from plan "Slice A1", recorded
// in the report: a session needs a recorded supervisor worktree): under
// the lock, it runs the creation it is given and appends the returned
// `WorktreeCreated`; with one already recorded it refuses and runs
// nothing. The creation itself is worktreeProgram's, tested elsewhere.
import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit, Option, Schema } from "effect"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { LogPosition, type ProjectLog, WorktreeCreated } from "../../src/domain/events.ts"
import { Revision } from "../../src/domain/ids.ts"
import { createRecordedWorktree, WorktreeAlreadyRecorded } from "../../src/program/worktree-command.ts"
import type { WorktreeRequest } from "../../src/program/worktree.ts"
import { openProjectLog } from "../../src/runtime/project-log.ts"
import { tryLock } from "../../src/runtime/project-lock.ts"

const created = new WorktreeCreated({
  path: "/state/worktree",
  branch: "tarlatan/t",
  gitDir: "/owner/.git/worktrees/worktree",
  commonDir: "/owner/.git",
  base: Revision.make("a".repeat(40)),
})
const request: WorktreeRequest = { ownerCheckout: "/owner", path: "/state/worktree", name: "t", start: Option.none() }

interface Deps {
  readonly log: ProjectLog
  readonly dir: string
}

const withLog = <A, E>(use: (deps: Deps) => Effect.Effect<A, E>) => {
  const dir = mkdtempSync(`${tmpdir()}/tarlatan-worktree-command-`)
  return Effect.ensuring(
    Effect.scoped(Effect.flatMap(openProjectLog(`${dir}/log.sqlite`, 50), (log) => use({ log, dir }))),
    Effect.sync(() => {
      rmSync(dir, { recursive: true, force: true })
    }),
  )
}

/** A creation that records each request and returns `created`. */
const recordingCreate = () => {
  const requests: Array<WorktreeRequest> = []
  const create = (given: WorktreeRequest) =>
    Effect.sync(() => {
      requests.push(given)
      return created
    })
  return { requests, create }
}

const createsAndRecords = ({ log, dir }: Deps) =>
  Effect.gen(function* () {
    const { requests, create } = recordingCreate()
    const result = yield* createRecordedWorktree({ log, lock: tryLock(`${dir}/lock.sqlite`), create }, request)
    expect(result).toEqual(created)
    expect(requests).toEqual([request])
    const logged = yield* log.readFrom(LogPosition.make(0))
    expect(logged.map((entry) => entry.event)).toEqual([created])
  })

const refusesSecond = ({ log, dir }: Deps) =>
  Effect.gen(function* () {
    yield* log.append(LogPosition.make(0), [created])
    const { requests, create } = recordingCreate()
    const exit = yield* Effect.exit(createRecordedWorktree({ log, lock: tryLock(`${dir}/lock.sqlite`), create }, request))
    const error = Exit.isFailure(exit) ? Exit.findErrorOption(exit) : Option.none()
    expect(Option.exists(error, Schema.is(WorktreeAlreadyRecorded))).toBe(true)
    expect(requests).toEqual([])
    expect((yield* log.readFrom(LogPosition.make(0))).length).toBe(1)
  })

describe("createRecordedWorktree", () => {
  it.effect("creates the worktree and appends WorktreeCreated", () => withLog(createsAndRecords))
  it.effect("refuses when a worktree is already recorded and runs no creation", () => withLog(refusesSecond))
})
