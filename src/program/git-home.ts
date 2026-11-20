// Git's private HOME before any git command (batch review B02; plan B11b,
// ruling 2): Runtime reads what is at `<stateDir>/git-home`; when nothing
// is there it creates a fresh directory with mode 0700 and reads again;
// Features judges the reading. An existing entry is judged as it is: a
// non-empty, linked, foreign or wider-than-0700 home is refused, and
// nothing at the path is cleared, moved or changed.
import { Effect, Result, Schema } from "effect"
import { type GitHomeRefused, HomeAbsent } from "../domain/git-home.ts"
import { judgeGitHome } from "../features/git-home.ts"
import { createHome, readHome } from "../runtime/git-home.ts"

/** Where git's HOME lives in the state directory `stateDir`. */
export const gitHomePath = (stateDir: string): string => `${stateDir}/git-home`

/**
 * Prepares git's HOME at `path` and returns the path, or fails with
 * `GitHomeRefused`. When nothing was there, the reading after the
 * creation is judged, so a refusal names what is there; if the path is
 * still empty, the creation's own failure is the reason.
 */
export const preparedGitHome = (path: string) =>
  Effect.gen(function* () {
    const first = yield* readHome(path)
    const reading = Schema.is(HomeAbsent)(first) ? yield* createdHome(path) : first
    yield* Effect.fromResult(judgeGitHome(path, reading))
    return path
  })

/** Creates the home and reads it again; a creation that left nothing there reads as its failure. */
const createdHome = (path: string) =>
  Effect.gen(function* () {
    const created = yield* Effect.result(createHome(path))
    const after = yield* readHome(path)
    return Schema.is(HomeAbsent)(after) && Result.isFailure(created) ? created.failure : after
  })

/**
 * Judges what is at git's HOME `path` without creating or changing
 * anything: the reading that `preparedGitHome` judges, for `status`,
 * which never makes the HOME (review item B11). Absent is refused like
 * any other unusable reading. Never fails.
 */
export const judgedGitHome = (path: string): Effect.Effect<Result.Result<void, GitHomeRefused>> =>
  Effect.map(readHome(path), (reading) => judgeGitHome(path, reading))
