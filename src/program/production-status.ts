// The production wiring of `status` (plan "Commands and their
// prerequisites"; review item B11): it creates nothing and writes
// nothing. It reads and decodes the configuration file, checks the
// layout as production does (batch review B05; the check only resolves
// paths, so it creates nothing), then opens the
// project log in the state directory and the owner's shared ledger,
// `<ledgerDir>/ledger.sqlite` (batch review B09), read-only, and only if
// they are there; it takes no project lock. A state directory without
// a log is reported as `StateMissing`, and nothing is created in it. The
// ledger is read in one deferred transaction, so status answers while
// another process holds the ledger's write lock. The worktree check runs
// as production.ts runs it, with the same empty git home, which a
// missing directory reads as empty.
import { Effect, Formatter, Option, Record, Schema } from "effect"
import type { Scope } from "effect"
import type { WorktreeCreated } from "../domain/events.ts"
import { defaultPolicy } from "../domain/policy.ts"
import { allocationsInFallback } from "../features/admission.ts"
import { clientEnvironment } from "../features/client-environment.ts"
import { ownerOnly } from "../features/counting.ts"
import { decodeForemanConfig, ledgerDirOf, ledgerFileName } from "../format/foreman-config.ts"
import { decodeRevParseRevision } from "../format/rev-parse.ts"
import { readClientVersionWith } from "../runtime/client-version.ts"
import { pinnedGitWith, startGit } from "../runtime/git.ts"
import { readProcesses } from "../runtime/processes.ts"
import { openLedgerReader, openLogReader } from "../runtime/state-read.ts"
import { stateFiles } from "../runtime/state-files.ts"
import { readOwnerHeadWith } from "../runtime/worktree.ts"
import { utf8Text } from "./client-output.ts"
import { checkedLayout } from "./layout.ts"
import { initialEstimates } from "./production.ts"
import { WorktreeUnready } from "./session-context.ts"
import { status, StatusReport } from "./status.ts"
import type { StatusContext } from "./status-context.ts"
import { worktreeProgramWith, type WorktreeProgram } from "./worktree.ts"

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
    const config = yield* Effect.fromResult(decodeForemanConfig(yield* utf8Text(yield* stateFiles.read(configPath))))
    const { stateDir } = config
    const ledgerDir = yield* Effect.fromResult(ledgerDirOf(config, Option.fromNullishOr(environment.HOME)))
    yield* checkedLayout({
      stateDir,
      ownerCheckout: config.ownerCheckout,
      supervisor: config.supervisor.path,
      ledgerDir,
    })
    const logPath = `${stateDir}/log.sqlite`
    const log = yield* openLogReader(logPath, busyTimeoutMillis)
    if (Option.isNone(log)) return new StateMissing({ stateDir, logPath })
    const ledger = yield* openLedgerReader(`${ledgerDir}/${ledgerFileName}`, busyTimeoutMillis)
    const home = `${stateDir}/git-home`
    const worktree = worktreeProgramWith(startGit, config.attributeAllowance)(home)
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
        checkWorktree: (recorded) => checkedHead(worktree, home, recorded),
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

/**
 * The startup check (`identifyWorktree`), then the worktree's HEAD read
 * through the runner pinned to the record (plan B11d) and decoded; the
 * same check production.ts gives the other commands.
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
