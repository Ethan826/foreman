// The production wiring of `status` (plan "Commands and their
// prerequisites"; review items B11 and B04 together): it creates nothing,
// writes nothing, takes no lock and no write transaction, and stays
// reachable when the configuration names another target.
//
// It decodes the configuration and checks the configured layout
// (production-target.ts; batch review B05 and B09; the check only
// resolves paths). It reads the state directory's target binding if
// there is one, runs on the recorded target, and reports whether the
// configuration agrees with it; a mismatch is shown, never refused, and
// no binding is recorded. It opens the project log in the state
// directory and the target's shared ledger read-only, and only if they
// are there; a state directory without a log is `StateMissing`, and a
// missing ledger reads as no rows. The ledger is read in one deferred
// transaction, so status answers while another process holds the
// ledger's write lock.
//
// Git's private HOME is judged by B02's rule from a reading alone and
// never made. When it is usable, the worktree check runs as production.ts
// runs it (`checkedHead`, the attribute check included, batch review
// B07). When it is missing or refused, status reports why and skips the
// git-based worktree check, so no git command runs with that HOME.
import { Effect, Option, Record, Result, Schema } from "effect"
import type { Scope } from "effect"
import { GitHomeRefused } from "../domain/git-home.ts"
import { defaultPolicy } from "../domain/policy.ts"
import { type TargetBinding, TargetMismatch } from "../domain/target.ts"
import { allocationsInFallback } from "../features/admission.ts"
import { clientEnvironment } from "../features/client-environment.ts"
import { ownerOnly } from "../features/counting.ts"
import { compareTarget } from "../features/target-binding.ts"
import { readClientVersionWith } from "../runtime/client-version.ts"
import { startGit } from "../runtime/git.ts"
import { readProcesses } from "../runtime/processes.ts"
import { openLedgerReader, openLogReader } from "../runtime/state-read.ts"
import { stateFiles } from "../runtime/state-files.ts"
import { gitHomePath, judgedGitHome } from "./git-home.ts"
import { handoffGitWith } from "./handoff-git.ts"
import { checkedHead, initialEstimates } from "./production.ts"
import { checkedTargetLayout, configuredTarget } from "./production-target.ts"
import { type CheckWorktree, WorktreeUnready } from "./session-context.ts"
import { status, StatusReport } from "./status.ts"
import type { StatusContext } from "./status-context.ts"
import { bindingPath, recordedTarget } from "./target-binding.ts"
import { worktreeProgramWith } from "./worktree.ts"

/** How long a status read waits for a lock SQLite holds briefly, in milliseconds. */
const busyTimeoutMillis = 5_000

/** The state directory has no project log, so there is no state to show; nothing was created. */
export class StateMissing extends Schema.TaggedClass<StateMissing>()("StateMissing", {
  stateDir: Schema.String,
  logPath: Schema.String,
}) {}

/** No target binding is recorded in the state directory; status ran on the configured target. */
export class TargetUnbound extends Schema.TaggedClass<TargetUnbound>()("TargetUnbound", {}) {}

/** The configuration names the target recorded in `binding`. */
export class TargetBound extends Schema.TaggedClass<TargetBound>()("TargetBound", {
  binding: Schema.String,
}) {}

/**
 * The state directory's binding as status found it (batch review B04):
 * none, agreeing with the configuration, or a `TargetMismatch` listing
 * each difference, under which status ran on the recorded target.
 */
export const TargetReading = Schema.Union([TargetUnbound, TargetBound, TargetMismatch])
/** The binding as status found it; see {@link TargetReading}. */
export type TargetReading = typeof TargetReading.Type

/** Git's HOME at `path` passes B02's checks, so the worktree check ran with it. */
export class GitHomeUsable extends Schema.TaggedClass<GitHomeUsable>()("GitHomeUsable", {
  path: Schema.String,
}) {}

/**
 * Git's HOME as status judged it, without making it (batch review B02):
 * usable, or `GitHomeRefused` with every reason, in which case the
 * worktree check was skipped.
 */
export const GitHomeReading = Schema.Union([GitHomeUsable, GitHomeRefused])
/** Git's HOME as status judged it; see {@link GitHomeReading}. */
export type GitHomeReading = typeof GitHomeReading.Type

/** What `status` shows in production: the target binding, git's HOME and the status report. */
export class ProductionStatusReport extends Schema.TaggedClass<ProductionStatusReport>()("ProductionStatusReport", {
  target: TargetReading,
  gitHome: GitHomeReading,
  report: StatusReport,
}) {}

/** What `status` prints: the report, or that the state is missing. */
export const StatusOutcome = Schema.Union([StateMissing, ProductionStatusReport])
/** The outcome of `status`; see {@link StatusOutcome}. */
export type StatusOutcome = typeof StatusOutcome.Type

/**
 * Runs `status` in production for the configuration at `configPath`;
 * `environment` is foreman's own, from which a client's version read
 * gets everything but `GIT_*` (decision P2) and the default ledger
 * directory its `HOME`. Fails with `ConfigUndecodable`, `LayoutRefused`,
 * `TargetBindingUnreadable` or a store's read failure; never with
 * `TargetMismatch`.
 */
export const productionStatus = (
  configPath: string,
  environment: Readonly<Record<string, string | undefined>>,
): Effect.Effect<StatusOutcome, unknown, Scope.Scope> =>
  Effect.gen(function* () {
    const { config, configured } = yield* configuredTarget(configPath, environment)
    const { stateDir } = config
    const recorded = yield* recordedTarget(stateDir)
    const target = Option.getOrElse(recorded, () => configured)
    yield* checkedTargetLayout(stateDir, target)
    const logPath = `${stateDir}/log.sqlite`
    const log = yield* openLogReader(logPath, busyTimeoutMillis)
    if (Option.isNone(log)) return new StateMissing({ stateDir, logPath })
    const ledger = yield* openLedgerReader(target.ledger, busyTimeoutMillis)
    const home = gitHomePath(stateDir)
    const homeJudged = yield* judgedGitHome(home)
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
        checkWorktree: Result.match(homeJudged, {
          onSuccess: () => worktreeCheck(target, home, stateDir),
          onFailure: skippedCheck,
        }),
        nowMono: Effect.succeed(Option.none()),
      },
      settings: {
        pins: config.pins,
        estimates: initialEstimates,
        admission: { policy: defaultPolicy, retirement: ownerOnly, allocations: allocationsInFallback },
      },
    }
    return new ProductionStatusReport({
      target: targetReading(stateDir, recorded, configured),
      gitHome: Result.match(homeJudged, { onSuccess: () => new GitHomeUsable({ path: home }), onFailure: (refused) => refused }),
      report: yield* status(context),
    })
  })

/** The worktree check production gives the other commands, run with the usable HOME `home`. */
const worktreeCheck = (target: TargetBinding, home: string, stateDir: string): CheckWorktree => {
  const worktree = worktreeProgramWith(startGit, target.attributeAllowance)(home)
  const handoffGit = handoffGitWith(startGit, target.attributeAllowance)(home, stateDir)
  return (recorded, base) => checkedHead({ worktree, home, handoffGit }, recorded, base)
}

/** The worktree check skipped because git's HOME is refused: it fails with the refusal, running nothing. */
const skippedCheck =
  (refused: GitHomeRefused): CheckWorktree =>
  () =>
    Effect.fail(
      new WorktreeUnready({
        reason: `git's HOME ${refused.path} cannot be used (${refused.reasons.join("; ")}); worktree check skipped`,
      }),
    )

/** The binding as found: none recorded, agreeing, or the mismatch with each difference. */
const targetReading = (
  stateDir: string,
  recorded: Option.Option<TargetBinding>,
  configured: TargetBinding,
): TargetReading =>
  Option.match(recorded, {
    onNone: () => new TargetUnbound(),
    onSome: (bound) =>
      Result.match(compareTarget(bindingPath(stateDir), bound, configured), {
        onSuccess: () => new TargetBound({ binding: bindingPath(stateDir) }),
        onFailure: (mismatch) => mismatch,
      }),
  })
