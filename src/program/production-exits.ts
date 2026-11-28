// The production wiring of the owner's exits, `step-ended` and `session
// close --abandoned | --interrupted | --unconverged` (re-review R02; plan "Commands and
// their prerequisites", AC1; focused review finding 2). They run no git
// command, so they are built from only what they use. Their target is
// settled by `exitTarget` (production-target.ts): the recorded target when
// a binding is recorded, whatever the configured layout says, as `status`
// runs; otherwise the configured one, whose layout is checked. A state
// directory that exists and is not a directory is refused before the
// binding is read (owner finding F2, dogfood-2). The layout of the target
// in force is checked with the state directory either way.
// `step-ended` then opens the project log and lock in the state directory
// and nothing else; the closes also open the target's ledger, for their
// settle step. Before the log is opened the state directory, and for a
// close the ledger directory too, is judged and then made, mode 0700,
// when it is missing and its parent exists; a close judges both before
// it makes either (dogfood-1 finding; owner finding F7; store-directory.ts).
// The binding is read before either is judged, so with a binding recorded
// the ledger directory judged and made is the recorded target's, and a
// changed configured `ledgerDir` is never touched (owner finding F10).
// Git's HOME is neither prepared nor judged here, so a
// contaminated `<stateDir>/git-home` does not block an exit; every
// command that runs git still prepares it and refuses it (production.ts,
// batch review B02).
import { Effect } from "effect"
import type { Scope } from "effect"
import type { TargetBinding } from "../domain/target.ts"
import { openLedger } from "../runtime/ledger-sqlite.ts"
import { openProjectLog } from "../runtime/project-log.ts"
import { tryLock } from "../runtime/project-lock.ts"
import { busyTimeoutMillis } from "./production.ts"
import { exitTarget, ledgerDirOfTarget } from "./production-target.ts"
import { preparedStoreDirectories, preparedStoreDirectory } from "./store-directory.ts"
import type { ExitContext, StepEndedContext } from "./session.ts"

/** What `session close --abandoned | --interrupted | --unconverged` runs with in production: the target in force and the close's context. */
export interface ExitProduction {
  /** The recorded target when there is one, else the configured one; nothing is recorded. */
  readonly target: TargetBinding
  readonly context: ExitContext
}

/** What `step-ended` runs with in production: the target in force and the log and lock alone. */
export interface StepEndedProduction {
  /** The recorded target when there is one, else the configured one; nothing is recorded. */
  readonly target: TargetBinding
  readonly context: StepEndedContext
}

/**
 * The production capabilities of `step-ended`, for the configuration at
 * `configPath`; `environment` supplies `HOME` for the default ledger
 * directory. Opens the project log and lock and never the ledger, which
 * the command does not use (focused review finding 2). Makes a missing
 * state directory first (store-directory.ts). Fails with
 * `ConfigUndecodable`, `LayoutRefused`, `TargetBindingUnreadable`,
 * `StoreDirectoryParentMissing` or `StoreDirectoryRefused`, among others,
 * and never with `GitHomeRefused`.
 */
export const stepEndedProduction = (
  configPath: string,
  environment: Readonly<Record<string, string | undefined>>,
): Effect.Effect<StepEndedProduction, unknown, Scope.Scope> =>
  Effect.gen(function* () {
    const { config, target } = yield* exitTarget(configPath, environment)
    const stateDir = yield* preparedStoreDirectory(config.stateDir)
    const context: StepEndedContext = {
      capabilities: {
        log: yield* openProjectLog(`${stateDir}/log.sqlite`, busyTimeoutMillis),
        lock: tryLock(`${stateDir}/lock.sqlite`),
      },
    }
    return { target, context }
  })

/**
 * The production capabilities of `session close --abandoned |
 * --interrupted | --unconverged`, for the configuration at `configPath`; `environment`
 * supplies `HOME` for the default ledger directory. They stay reachable
 * under a mismatched configuration or a refused configured layout and run
 * on the recorded target (batch review B04, AC1). Opens the project log,
 * the lock and the target's ledger, which the settle step writes, after
 * judging the state directory and the ledger directory and only then
 * making a missing one, so a refused ledger directory leaves no state
 * directory (store-directory.ts; owner finding F7, dogfood-2). Fails with `ConfigUndecodable`, `LayoutRefused`,
 * `TargetBindingUnreadable`, `StoreDirectoryParentMissing` or
 * `StoreDirectoryRefused`, among others, and never with `GitHomeRefused`.
 */
export const exitProduction = (
  configPath: string,
  environment: Readonly<Record<string, string | undefined>>,
): Effect.Effect<ExitProduction, unknown, Scope.Scope> =>
  Effect.gen(function* () {
    // The exits deliberately do not compare the configured target with the
    // recorded binding: they run on the recorded target and never fail with
    // `TargetMismatch`, so a changed or broken configuration cannot block the
    // way out of a session (owner ruling, dogfood-2b round 2; assisted-cycle
    // plan, focused review item 2).
    const { config, target } = yield* exitTarget(configPath, environment)
    const { stateDir } = config
    yield* preparedStoreDirectories([stateDir, ledgerDirOfTarget(target)])
    const context: ExitContext = {
      capabilities: {
        log: yield* openProjectLog(`${stateDir}/log.sqlite`, busyTimeoutMillis),
        ledger: yield* openLedger(target.ledger, busyTimeoutMillis),
        lock: tryLock(`${stateDir}/lock.sqlite`),
      },
      settings: { project: target.projectId },
    }
    return { target, context }
  })
