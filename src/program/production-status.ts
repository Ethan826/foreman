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
// log once, and the ledger of the target in force once, each read-only in
// one deferred transaction, before it builds the status context, so status
// answers while another process holds the ledger's write lock; a missing
// ledger, or no target in force, reads as no rows.
//
// It reports each store's format version as the header read in the
// snapshot its rows came from (`storeVersions`; dogfood-5, owner rulings
// P5 and P6; review finding F6) and stamps nothing, so 0 means a store
// v0.1.0 wrote. A log stamped newer than this release knows, or below 0,
// at the open or in the read's snapshot, fails status, since without the
// log there is nothing to report. The shared ledger can be stamped newer
// by another project's newer release, so a refused ledger, at the open or
// in the snapshot, is a finding instead: status reads none of its rows,
// shows the version found and reads the ledger as having no rows.
//
// Git's private HOME is judged by B02's rule from a reading alone and
// never made. The git-based worktree check runs as production.ts runs it
// (`checkedHead`, the attribute check included, batch review B07) only
// when a target is in force, no layout is refused and the HOME is
// usable; otherwise status reports why and runs no git command.
import { Array as Arr, Effect, Match, Option, Record, Result, Schema } from "effect"
import type { Scope } from "effect"
import { GitHomeRefused } from "../domain/git-home.ts"
import { type LoggedEvent, LogPosition } from "../domain/events.ts"
import type { LedgerBusy, LedgerError, LedgerSnapshot } from "../domain/ledger.ts"
import { defaultPolicy } from "../domain/policy.ts"
import type { TargetBinding } from "../domain/target.ts"
import { allocationsInFallback } from "../features/admission.ts"
import { clientEnvironment } from "../features/client-environment.ts"
import { ownerOnly } from "../features/counting.ts"
import { readClientVersionWith } from "../runtime/client-version.ts"
import { startGit } from "../runtime/git.ts"
import { readProcesses } from "../runtime/processes.ts"
import {
  invalidVersionReason,
  knownStoreVersion,
  StoreVersionNewer,
  type StoreVersionRefusal,
} from "../domain/store-version.ts"
import { openLedgerReading, openLogReader, type VersionedRead } from "../runtime/state-read.ts"
import { stateFiles } from "../runtime/state-files.ts"
import { gitHomePath, judgedGitHome } from "./git-home.ts"
import { handoffGitWith } from "./handoff-git.ts"
import { checkedHead, initialEstimates } from "./production.ts"
import { configuredLayout, readConfiguration } from "./production-target.ts"
import { type CheckWorktree, WorktreeUnready } from "./session-context.ts"
import { status, StatusReport } from "./status.ts"
import type { StatusContext } from "./status-context.ts"
import {
  LedgerVersionInvalid,
  StatusFinding,
  type StatusTarget,
  statusTarget,
  TargetInForce,
  TargetReading,
} from "./status-target.ts"
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
 * Each store's format version as status read it from the header, never
 * stamped (owner ruling P5): `log` always, and `ledger` when a target is
 * in force and its ledger file is there. 0 means a store v0.1.0 wrote that
 * no writer of this release has opened since. A ledger status refused for
 * its version shows the version found. Printed as `{"log": 1, "ledger": 0}`,
 * or `{"log": 1}` with no ledger.
 */
export const StoreVersions = Schema.Struct({
  log: Schema.Int,
  ledger: Schema.OptionFromOptionalKey(Schema.Int),
})
/** Each store's format version as status read it; see {@link StoreVersions}. */
export type StoreVersions = typeof StoreVersions.Type

/**
 * What `status` shows in production: the findings, the binding against
 * the configuration, the target it ran on, git's HOME, the status report
 * (re-review R03), the check commands the decoded configuration names,
 * in its order (dogfood-3b), and each store's format version (dogfood-5).
 */
export class ProductionStatusReport extends Schema.TaggedClass<ProductionStatusReport>()("ProductionStatusReport", {
  findings: Schema.Array(StatusFinding),
  target: TargetReading,
  inForce: TargetInForce,
  gitHome: GitHomeReading,
  report: StatusReport,
  checkCommands: Schema.Array(Schema.String),
  storeVersions: StoreVersions,
}) {}

/** What `status` prints: the report, or that the state is missing. */
export const StatusOutcome = Schema.Union([StateMissing, ProductionStatusReport])
/** The outcome of `status`; see {@link StatusOutcome}. */
export type StatusOutcome = typeof StatusOutcome.Type

/**
 * Runs `status` in production for the configuration at `configPath`;
 * `environment` is tarlatan's own, from which a client's version read
 * gets everything but `GIT_*` (decision P2) and the default ledger
 * directory its `HOME`. A broken layout or binding is a finding in the
 * outcome, never a failure, and so is a default ledger directory that
 * cannot be settled because `HOME` is unset: status then runs on the
 * recorded target, or on none, and still reads the log (follow-up review
 * at 3b72efc, finding 4). A ledger stamped newer than this release
 * knows, or below 0, is a finding too, and its rows are not read (owner
 * ruling P6). Fails only when the configuration cannot be read or decoded
 * (`ConfigUndecodable`, among others), a store cannot be read, or the
 * project log is stamped newer (`StoreVersionNewer`) or below 0.
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
    const logRead = yield* log.value.versionedFrom(LogPosition.make(0))
    const home = gitHomePath(stateDir)
    const homeJudged = yield* judgedGitHome(home)
    const parentEnvironment = Record.getSomes(Record.map(environment, Option.fromNullishOr))
    const ledger = yield* ledgerOf(settled.inForce)
    const context: StatusContext = {
      capabilities: {
        log: { readFrom: (position) => Effect.succeed(eventsAfter(logRead.events, position)) },
        ledgerRows: Effect.succeed(ledger.rows),
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
      findings: Arr.appendAll(settled.findings, Option.toArray(ledger.finding)),
      gitHome: Result.match(homeJudged, { onSuccess: () => new GitHomeUsable({ path: home }), onFailure: (refused) => refused }),
      report: yield* status(context),
      checkCommands: config.checkCommands,
      storeVersions: { log: logRead.version, ledger: ledger.version },
    })
  })

/**
 * The events of `events` after `position`, as the log's `readFrom` gives
 * them; status reads the log once, so the version it reports is the one
 * of the snapshot its events came from (review finding F6).
 */
const eventsAfter = (events: ReadonlyArray<LoggedEvent>, position: LogPosition): ReadonlyArray<LoggedEvent> =>
  Arr.filter(events, (entry) => entry.position > position)

/**
 * What status took from the ledger of the target in force, all from one
 * read (review finding F6): its rows, none when there is no ledger or its
 * version refused it; the format version that read's snapshot found; and
 * the finding when that version refused it (owner ruling P6).
 */
export interface LedgerTaken {
  /** Every ledger row as read; none with no ledger, or one refused for its version. */
  readonly rows: Option.Option<LedgerSnapshot>
  /** The ledger's format version as the read found it; none with no ledger. */
  readonly version: Option.Option<number>
  /** The finding for a ledger refused for its version (newer, or below 0). */
  readonly finding: Option.Option<StatusFinding>
}

/** No ledger: no target is in force or no ledger file is there, so no rows, no version and no finding. */
const noLedger: LedgerTaken = { rows: Option.none(), version: Option.none(), finding: Option.none() }

/**
 * The ledger of the target in force, opened read-only for the scope and
 * read once; no ledger when its file is missing or no target is in force.
 */
const ledgerOf = (inForce: TargetInForce): Effect.Effect<LedgerTaken, LedgerError | LedgerBusy, Scope.Scope> =>
  Match.value(inForce).pipe(
    Match.tag("NoTargetInForce", () => Effect.succeed(noLedger)),
    Match.orElse((target) => ledgerAt(target.binding.ledger)),
  )

/** The ledger at `path`, opened read-only for the scope and read once; see {@link LedgerTaken}. */
const ledgerAt = (path: string) =>
  Effect.map(openLedgerReading(path, busyTimeoutMillis), (opened) =>
    Option.match(opened, { onNone: () => noLedger, onSome: ledgerTaken(path) }),
  )

/**
 * What status takes from one read of the ledger at `path`. When the
 * version the read's snapshot found allows reading, its rows and that
 * version. When it refused the ledger, at the open or in the snapshot
 * (owner ruling P6, review finding F6), no rows, so status reads the
 * ledger as having none, the version found, and the finding that says why.
 */
export const ledgerTaken =
  (path: string) =>
  (read: VersionedRead<LedgerSnapshot>): LedgerTaken =>
    Result.match(read.rows, {
      onSuccess: (rows): LedgerTaken => ({ rows: Option.some(rows), version: Option.some(read.version), finding: Option.none() }),
      onFailure: (refusal): LedgerTaken => ({
        rows: Option.none(),
        version: Option.some(read.version),
        finding: Option.some(versionFinding(path, refusal)),
      }),
    })

/** The finding for the ledger at `path` refused for its version: newer, or below 0 (owner rulings P2, P6). */
const versionFinding = (path: string, refusal: StoreVersionRefusal): StatusFinding =>
  Match.value(refusal).pipe(
    Match.withReturnType<StatusFinding>(),
    Match.tag("StoreNewer", (newer) => new StoreVersionNewer({ path, found: newer.found, known: knownStoreVersion })),
    Match.tag(
      "StoreVersionInvalid",
      (invalid) => new LedgerVersionInvalid({ path, found: invalid.found, reason: invalidVersionReason(invalid.found) }),
    ),
    Match.exhaustive,
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
