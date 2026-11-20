// `foreman worktree create`: creates the supervisor worktree with
// `worktreeProgram`'s creation (design "Supervisor worktree", plan B11a
// to B11d) and records it, because a session needs a recorded worktree.
// This command is a deviation from plan "Slice A1", whose boundary does
// not name it. Under the lock it refuses when the log already records a
// worktree, so creation runs at most once; otherwise it creates, then
// appends `WorktreeCreated`. It writes no `WorktreeIntended` and does no
// recovery: a crash between the add and the append leaves a worktree the
// log does not record, which the next run's creation refuses as an
// existing branch or path and the owner resolves.
import { Effect, Option, Schema } from "effect"
import type { Scope } from "effect"
import type { LockHeld, ProjectLog, ProjectLogError, WorktreeCreated } from "../domain/events.ts"
import { readLog, recordedWorktree } from "./command-start.ts"
import type { WorktreeRequest } from "./worktree.ts"

/** The log already records a supervisor worktree at `path`; nothing was created. */
export class WorktreeAlreadyRecorded extends Schema.TaggedError<WorktreeAlreadyRecorded>()(
  "WorktreeAlreadyRecorded",
  { path: Schema.String },
) {}

/** What `worktree create` runs over. */
export interface WorktreeCommandCapabilities<E> {
  readonly log: ProjectLog
  readonly lock: Effect.Effect<void, LockHeld | ProjectLogError, Scope.Scope>
  /** The creation: production passes `worktreeProgram`'s `createWorktree`. */
  readonly create: (request: WorktreeRequest) => Effect.Effect<WorktreeCreated, E>
}

/**
 * Creates and records the supervisor worktree (see the module comment).
 * Fails with {@link WorktreeAlreadyRecorded}, creating nothing, when one
 * is recorded, and with the creation's own failures.
 */
export const createRecordedWorktree = <E>(capabilities: WorktreeCommandCapabilities<E>, request: WorktreeRequest) =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* capabilities.lock
      const read = yield* readLog(capabilities.log)
      const existing = recordedWorktree(read.events)
      if (Option.isSome(existing)) return yield* new WorktreeAlreadyRecorded({ path: existing.value.path })
      const created = yield* capabilities.create(request)
      yield* capabilities.log.append(read.position, [created])
      return created
    }),
  )
