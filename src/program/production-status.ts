// The production wiring of `status` (plan "Commands and their
// prerequisites"; review item B11): it creates nothing and writes
// nothing. It settles the target as the reachable commands do
// (production-target.ts; batch review B04, B05 and B09): the
// configuration decoded, the layout checked, and the state directory's
// recorded target in force when there is one; it records no binding,
// and the layout check only resolves paths. It then opens the project
// log in the state directory and the target's shared ledger read-only,
// and only if they are there; it takes no project lock. A state directory without
// a log is reported as `StateMissing`, and nothing is created in it. The
// ledger is read in one deferred transaction, so status answers while
// another process holds the ledger's write lock. The worktree check runs
// as production.ts runs it (`checkedHead`, the attribute check included,
// batch review B07), with the same empty git home, which a missing
// directory reads as empty.
import { Effect, Option, Record, Schema } from "effect"
import type { Scope } from "effect"
import { defaultPolicy } from "../domain/policy.ts"
import { allocationsInFallback } from "../features/admission.ts"
import { clientEnvironment } from "../features/client-environment.ts"
import { ownerOnly } from "../features/counting.ts"
import { readClientVersionWith } from "../runtime/client-version.ts"
import { startGit } from "../runtime/git.ts"
import { readProcesses } from "../runtime/processes.ts"
import { openLedgerReader, openLogReader } from "../runtime/state-read.ts"
import { stateFiles } from "../runtime/state-files.ts"
import { handoffGitWith } from "./handoff-git.ts"
import { checkedHead, initialEstimates } from "./production.ts"
import { settledTarget } from "./production-target.ts"
import { status, StatusReport } from "./status.ts"
import type { StatusContext } from "./status-context.ts"
import { recordedOrConfigured } from "./target-binding.ts"
import { worktreeProgramWith } from "./worktree.ts"

/** How long a status read waits for a lock SQLite holds briefly, in milliseconds. */
const busyTimeoutMillis = 5_000

/** The state directory has no project log, so there is no state to show; nothing was created. */
export class StateMissing extends Schema.TaggedClass<StateMissing>()("StateMissing", {
  stateDir: Schema.String,
  logPath: Schema.String,
}) {}

/** What `status` prints: the report, or that the state is missing. */
export const StatusOutcome = Schema.Union([StateMissing, StatusReport])
/** The outcome of `status`; see {@link StatusOutcome}. */
export type StatusOutcome = typeof StatusOutcome.Type

/**
 * Runs `status` in production for the configuration at `configPath`;
 * `environment` is foreman's own, from which a client's version read
 * gets everything but `GIT_*` (decision P2). Fails with
 * `ConfigUndecodable` or a store's read failure.
 */
export const productionStatus = (
  configPath: string,
  environment: Readonly<Record<string, string | undefined>>,
): Effect.Effect<StatusOutcome, unknown, Scope.Scope> =>
  Effect.gen(function* () {
    const { config, target } = yield* settledTarget(recordedOrConfigured, configPath, environment)
    const { stateDir } = config
    const logPath = `${stateDir}/log.sqlite`
    const log = yield* openLogReader(logPath, busyTimeoutMillis)
    if (Option.isNone(log)) return new StateMissing({ stateDir, logPath })
    const ledger = yield* openLedgerReader(target.ledger, busyTimeoutMillis)
    const home = `${stateDir}/git-home`
    const worktree = worktreeProgramWith(startGit, target.attributeAllowance)(home)
    const handoffGit = handoffGitWith(startGit, target.attributeAllowance)(home, stateDir)
    const parentEnvironment = Record.getSomes(Record.map(environment, Option.fromNullishOr))
    const context: StatusContext = {
      capabilities: {
        log: log.value,
        ledgerRows: Option.match(ledger, {
          onNone: () => Effect.succeed(Option.none()),
          onSome: (reader) => Effect.map(reader.read, Option.some),
        }),
        readProcesses,
        readClientVersion: readClientVersionWith({ cwd: stateDir, env: clientEnvironment(parentEnvironment) }),
        stateFiles,
        checkWorktree: (recorded, base) => checkedHead({ worktree, home, handoffGit }, recorded, base),
        nowMono: Effect.succeed(Option.none()),
      },
      settings: {
        pins: config.pins,
        estimates: initialEstimates,
        admission: { policy: defaultPolicy, retirement: ownerOnly, allocations: allocationsInFallback },
      },
    }
    return yield* status(context)
  })
