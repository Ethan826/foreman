// The production wiring of `status` (plan "Commands and their
// prerequisites"; review items B11 and B04 together; re-review R03): it
// creates nothing, writes nothing, takes no lock and no write
// transaction, stays reachable when the configuration names another
// target, and reports what is broken beside whatever it can read.
//
// It decodes the configuration, then settles the target it runs on
// (status-target.ts): a refused configured layout, a configured ledger
// directory it cannot settle (the default with HOME unset), an unreadable
// binding and a refused recorded layout are findings, never refusals, and
// no binding is recorded. It opens the project log in the configured state
// directory read-only and only if it is there; a state directory without
// a log is `StateMissing`, which carries the findings too. It reads the
// ledger of the target in force read-only, in one deferred transaction,
// so status answers while another process holds the ledger's write lock;
// a missing ledger, or no target in force, reads as no rows.
//
// Git's private HOME is judged by B02's rule from a reading alone and
// never made. The git-based worktree check runs as production.ts runs it
// (`checkedHead`, the attribute check included, batch review B07) only
// when a target is in force, no layout is refused and the HOME is
// usable; otherwise status reports why and runs no git command.
import { Array as Arr, Effect, Match, Option, Record, Result, Schema } from "effect"
import type { Scope } from "effect"
import { GitHomeRefused } from "../domain/git-home.ts"
import { defaultPolicy } from "../domain/policy.ts"
import type { TargetBinding } from "../domain/target.ts"
import { allocationsInFallback } from "../features/admission.ts"
import { clientEnvironment } from "../features/client-environment.ts"
import { ownerOnly } from "../features/counting.ts"
import { readClientVersionWith } from "../runtime/client-version.ts"
import { startGit } from "../runtime/git.ts"
import { readProcesses } from "../runtime/processes.ts"
import { type LedgerReader, openLedgerReader, openLogReader } from "../runtime/state-read.ts"
import { stateFiles } from "../runtime/state-files.ts"
import { gitHomePath, judgedGitHome } from "./git-home.ts"
import { handoffGitWith } from "./handoff-git.ts"
import { checkedHead, initialEstimates } from "./production.ts"
import { configuredLayout, readConfiguration } from "./production-target.ts"
import { type CheckWorktree, WorktreeUnready } from "./session-context.ts"
import { status, StatusReport } from "./status.ts"
import type { StatusCapabilities, StatusContext } from "./status-context.ts"
import { StatusFinding, type StatusTarget, statusTarget, TargetInForce, TargetReading } from "./status-target.ts"
import { worktreeProgramWith } from "./worktree.ts"

/** How long a status read waits for a lock SQLite holds briefly, in milliseconds. */
const busyTimeoutMillis = 5_000

/**
 * The state directory has no project log, so there is no state to show;
 * nothing was created. `findings` lists what status found wrong first.
 */
export class StateMissing extends Schema.TaggedClass<StateMissing>()("StateMissing", {
  stateDir: Schema.String,
  logPath: Schema.String,
  findings: Schema.Array(StatusFinding),
}) {}

/** Git's HOME at `path` passes B02's checks, so the worktree check may run with it. */
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

/**
 * What `status` shows in production: the findings, the binding against
 * the configuration, the target it ran on, git's HOME, the status report
 * (re-review R03) and the check commands the decoded configuration names,
 * in its order (dogfood-3b).
 */
export class ProductionStatusReport extends Schema.TaggedClass<ProductionStatusReport>()("ProductionStatusReport", {
  findings: Schema.Array(StatusFinding),
  target: TargetReading,
  inForce: TargetInForce,
  gitHome: GitHomeReading,
  report: StatusReport,
  checkCommands: Schema.Array(Schema.String),
}) {}

/** What `status` prints: the report, or that the state is missing. */
export const StatusOutcome = Schema.Union([StateMissing, ProductionStatusReport])
/** The outcome of `status`; see {@link StatusOutcome}. */
export type StatusOutcome = typeof StatusOutcome.Type

/**
 * Runs `status` in production for the configuration at `configPath`;
 * `environment` is foreman's own, from which a client's version read
 * gets everything but `GIT_*` (decision P2) and the default ledger
 * directory its `HOME`. A broken layout or binding is a finding in the
 * outcome, never a failure, and so is a default ledger directory that
 * cannot be settled because `HOME` is unset: status then runs on the
 * recorded target, or on none, and still reads the log (follow-up review
 * at 3b72efc, finding 4). Fails only when the configuration cannot be
 * read or decoded (`ConfigUndecodable`, among others) or a store cannot
 * be read.
 */
export const productionStatus = (
  configPath: string,
  environment: Readonly<Record<string, string | undefined>>,
): Effect.Effect<StatusOutcome, unknown, Scope.Scope> =>
  Effect.gen(function* () {
    const config = yield* readConfiguration(configPath)
    const { stateDir } = config
    const settled = yield* statusTarget(config, configuredLayout(config, environment))
    const logPath = `${stateDir}/log.sqlite`
    const log = yield* openLogReader(logPath, busyTimeoutMillis)
    if (Option.isNone(log)) return new StateMissing({ stateDir, logPath, findings: settled.findings })
    const home = gitHomePath(stateDir)
    const homeJudged = yield* judgedGitHome(home)
    const parentEnvironment = Record.getSomes(Record.map(environment, Option.fromNullishOr))
    const context: StatusContext = {
      capabilities: {
        log: log.value,
        ledgerRows: yield* ledgerRowsOf(settled.inForce),
        readProcesses,
        readClientVersion: readClientVersionWith({ cwd: stateDir, env: clientEnvironment(parentEnvironment) }),
        stateFiles,
        checkWorktree: checkFor(settled, homeJudged, stateDir),
        nowMono: Effect.succeed(Option.none()),
      },
      settings: {
        pins: config.pins,
        estimates: initialEstimates,
        admission: { policy: defaultPolicy, retirement: ownerOnly, allocations: allocationsInFallback },
      },
    }
    return new ProductionStatusReport({
      ...settled,
      gitHome: Result.match(homeJudged, { onSuccess: () => new GitHomeUsable({ path: home }), onFailure: (refused) => refused }),
      report: yield* status(context),
      checkCommands: config.checkCommands,
    })
  })

/**
 * The ledger rows of the target in force, read in one deferred
 * transaction; none when its ledger file is missing or no target is in
 * force. Opens the ledger read-only for the scope.
 */
const ledgerRowsOf = (inForce: TargetInForce) =>
  Effect.map(
    Match.value(inForce).pipe(
      Match.tag("NoTargetInForce", () => Effect.succeed(Option.none<LedgerReader>())),
      Match.orElse((target) => openLedgerReader(target.binding.ledger, busyTimeoutMillis)),
    ),
    (ledger): StatusCapabilities["ledgerRows"] =>
      Option.match(ledger, {
        onNone: () => Effect.succeed(Option.none()),
        onSome: (reader) => Effect.map(reader.read, Option.some),
      }),
  )

/**
 * The worktree check status runs: production's, when a target is in
 * force, no layout is refused and git's HOME is usable; otherwise one
 * that runs nothing and says why (re-review R03, batch review B02).
 */
const checkFor = (
  settled: StatusTarget,
  homeJudged: Result.Result<void, GitHomeRefused>,
  stateDir: string,
): CheckWorktree =>
  Match.value(settled.inForce).pipe(
    Match.tag("NoTargetInForce", () => skippedCheck("no target is in force")),
    Match.orElse((target) =>
      Arr.isReadonlyArrayNonEmpty(settled.findings)
        ? skippedCheck("a layout is refused")
        : Result.match(homeJudged, {
            onSuccess: () => worktreeCheck(target.binding, gitHomePath(stateDir), stateDir),
            onFailure: homeRefusedCheck,
          }),
    ),
  )

/** The worktree check production gives the other commands, run with the usable HOME `home`. */
const worktreeCheck = (target: TargetBinding, home: string, stateDir: string): CheckWorktree => {
  const worktree = worktreeProgramWith(startGit, target.attributeAllowance)(home)
  const handoffGit = handoffGitWith(startGit, target.attributeAllowance)(home, stateDir)
  return (recorded, base) => checkedHead({ worktree, home, handoffGit }, recorded, base)
}

/** The worktree check skipped because git's HOME is refused. */
const homeRefusedCheck = (refused: GitHomeRefused): CheckWorktree =>
  skippedCheck(`git's HOME ${refused.path} cannot be used (${refused.reasons.join("; ")})`)

/** A worktree check that runs nothing and fails with `reason`, so no git command runs. */
const skippedCheck =
  (reason: string): CheckWorktree =>
  () =>
    Effect.fail(new WorktreeUnready({ reason: `${reason}; worktree check skipped` }))
