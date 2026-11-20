// The production wiring of the assisted-session commands (plan "Injected
// capabilities"; decision P3): reads and decodes the configuration file,
// opens the project log and the ledger in the state directory, and
// builds every capability from Runtime. Nothing here decides; the
// facade calls one command with the context this returns.
//
// State directory layout: `log.sqlite`, `ledger.sqlite`, `lock.sqlite`,
// the session's published files, and `git-home`, the empty HOME every git
// command runs with (plan B11b); a missing `git-home` reads as empty.
import { Clock, Console, Effect, Formatter, Option, Random, Record } from "effect"
import type { Scope } from "effect"
import type { WorktreeCreated } from "../domain/events.ts"
import { clientEnvironment } from "../features/client-environment.ts"
import { allocationsInFallback } from "../features/admission.ts"
import { ownerOnly } from "../features/counting.ts"
import { defaultPolicy } from "../domain/policy.ts"
import { decodeForemanConfig, type ForemanConfig } from "../format/foreman-config.ts"
import { startTimeOf } from "../format/ps.ts"
import { decodeRevParseRevision } from "../format/rev-parse.ts"
import { readClientVersionWith } from "../runtime/client-version.ts"
import { pinnedGitWith, startGit } from "../runtime/git.ts"
import { openLedger } from "../runtime/ledger-sqlite.ts"
import { readProcesses } from "../runtime/processes.ts"
import { openProjectLog } from "../runtime/project-log.ts"
import { tryLock } from "../runtime/project-lock.ts"
import { startClientWith } from "../runtime/spawn.ts"
import { stateFiles } from "../runtime/state-files.ts"
import { readOwnerHeadWith } from "../runtime/worktree.ts"
import { utf8Text } from "./client-output.ts"
import { type SessionContext, WorktreeUnready } from "./session-context.ts"
import { worktreeProgramWith, type WorktreeProgram } from "./worktree.ts"

/** How long a log or ledger write waits for another writer, in milliseconds. */
const busyTimeoutMillis = 5_000

/** The radix of the id parts: digits and lower-case letters. */
const idRadix = 36

/** The random part of an id is below this bound (2^31). */
const idRandomBound = 2_147_483_648

/** Everything a command runs with in production. */
export interface Production {
  readonly config: ForemanConfig
  readonly context: SessionContext
  /** The supervisor worktree's creation and check, with the configured allowance. */
  readonly worktree: WorktreeProgram
}

/**
 * Reads the configuration at `configPath` and builds the production
 * capabilities for the scope; `environment` is foreman's own, from which
 * a client gets everything but `GIT_*` (decision P2). Fails with
 * `ConfigUndecodable` or the state files' and stores' failures.
 */
export const production = (
  configPath: string,
  environment: Readonly<Record<string, string | undefined>>,
): Effect.Effect<Production, unknown, Scope.Scope> =>
  Effect.gen(function* () {
    const text = yield* utf8Text(yield* stateFiles.read(configPath))
    const config = yield* Effect.fromResult(decodeForemanConfig(text))
    const { stateDir } = config
    const home = `${stateDir}/git-home`
    const worktree = worktreeProgramWith(startGit, config.attributeAllowance)(home)
    const parentEnvironment = Record.getSomes(Record.map(environment, Option.fromNullishOr))
    const context: SessionContext = {
      capabilities: {
        log: yield* openProjectLog(`${stateDir}/log.sqlite`, busyTimeoutMillis),
        ledger: yield* openLedger(`${stateDir}/ledger.sqlite`, busyTimeoutMillis),
        lock: tryLock(`${stateDir}/lock.sqlite`),
        startClient: startClientWith(readProcesses, startTimeOf),
        readProcesses,
        readClientVersion: readClientVersionWith({ cwd: stateDir, env: clientEnvironment(parentEnvironment) }),
        stateFiles,
        checkWorktree: (recorded) => checkedHead(worktree, home, recorded),
        newId,
        nowMono: Effect.succeed(Option.none()),
        show: Console.log,
        parentEnvironment,
      },
      settings: {
        project: config.projectId,
        stateDir,
        pins: config.pins,
        claudeSettings: config.claudeSettings,
        estimates: config.estimates,
        admission: { policy: defaultPolicy, retirement: ownerOnly, allocations: allocationsInFallback },
      },
    }
    return { config, context, worktree }
  })

/**
 * A fresh id slug: the wall clock and a random number, each in base 36,
 * joined by a hyphen. Unique enough for one owner's commands, which run
 * one at a time under the lock.
 */
const newId = Effect.gen(function* () {
  const millis = yield* Clock.currentTimeMillis
  const random = yield* Random.nextIntBetween(0, idRandomBound)
  return `${millis.toString(idRadix)}-${random.toString(idRadix)}`
})

/**
 * The startup check (`identifyWorktree`), then the worktree's HEAD read
 * through the runner pinned to the record (plan B11d) and decoded.
 */
const checkedHead = (worktree: WorktreeProgram, home: string, recorded: WorktreeCreated) =>
  Effect.mapError(
    Effect.gen(function* () {
      yield* worktree.identifyWorktree(recorded)
      const text = yield* readOwnerHeadWith(pinnedGitWith(startGit)(home)(recorded))(recorded.path)
      return yield* Effect.fromResult(decodeRevParseRevision(text))
    }),
    (failure) => new WorktreeUnready({ reason: Formatter.formatJson(failure) }),
  )
