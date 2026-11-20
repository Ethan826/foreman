// The production wiring of the owner's exits, `step-ended` and `session
// close --abandoned | --interrupted` (re-review R02; plan "Commands and
// their prerequisites", AC1). They run no git command, so they are built
// from only what they use: the target settled as for every reachable
// command (production-target.ts, under `recordedOrConfigured`), then the
// project log and lock in the state directory and the target's ledger.
// Git's HOME is neither prepared nor judged here, so a contaminated
// `<stateDir>/git-home` does not block an exit; every command that runs
// git still prepares it and refuses it (production.ts, batch review B02).
import { Effect } from "effect"
import type { Scope } from "effect"
import type { TargetBinding } from "../domain/target.ts"
import { openLedger } from "../runtime/ledger-sqlite.ts"
import { openProjectLog } from "../runtime/project-log.ts"
import { tryLock } from "../runtime/project-lock.ts"
import { busyTimeoutMillis } from "./production.ts"
import { settledTarget } from "./production-target.ts"
import type { ExitContext } from "./session.ts"
import { recordedOrConfigured } from "./target-binding.ts"

/** What an exit runs with in production: the target in force and the exit's context. */
export interface ExitProduction {
  /** The recorded target when there is one, else the configured one; nothing is recorded. */
  readonly target: TargetBinding
  readonly context: ExitContext
}

/**
 * The production capabilities of `step-ended` and `session close
 * --abandoned | --interrupted`, for the configuration at `configPath`;
 * `environment` supplies `HOME` for the default ledger directory. They
 * stay reachable under a mismatched configuration and run on the
 * recorded target (batch review B04). Fails with `ConfigUndecodable`,
 * `LayoutRefused` or `TargetBindingUnreadable`, among others, and never
 * with `GitHomeRefused`.
 */
export const exitProduction = (
  configPath: string,
  environment: Readonly<Record<string, string | undefined>>,
): Effect.Effect<ExitProduction, unknown, Scope.Scope> =>
  Effect.gen(function* () {
    const { config, target } = yield* settledTarget(recordedOrConfigured, configPath, environment)
    const { stateDir } = config
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
