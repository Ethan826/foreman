// The production wiring of the assisted-session commands (plan "Injected
// capabilities"; decision P3). It settles the target first
// (production-target.ts): the configuration decoded, the layout checked
// (batch review B05) and the target bound to the state directory (B04).
// A recorded binding is compared with the configuration first, before the
// layout rules, so a mismatch touches no directory and is reported as a
// mismatch (owner finding F10, dogfood-2b round 2). Then the state
// directory and the ledger directory are both judged, then each is made,
// mode 0700, when it is missing and its parent exists, and only then is a
// first binding recorded (dogfood-1 finding; owner finding F7;
// store-directory.ts).
// Then it prepares git's private HOME (B02), opens the project log and
// lock in the state directory and the owner's shared ledger (B09), and
// builds every capability from Runtime. Nothing here decides; the facade
// calls one command with the context this returns.
//
// The state directory holds `log.sqlite`, `lock.sqlite`, the target
// binding, Claude's editing profile, the session's published files and
// `git-home`, the empty HOME every git command runs with (plan B11b). A
// handoff's git work runs through the runner pinned to the session's
// recorded worktree, with the target's attribute allowance.
import { Clock, Console, Effect, Formatter, Option, Random, Record, Schema } from "effect"
import type { Scope } from "effect"
import { type AttributeSourcesRefused, AttributeSourcesUnread } from "../domain/attributes.ts"
import type { WorktreeCreated } from "../domain/events.ts"
import type { Revision } from "../domain/ids.ts"
import type { TargetBinding } from "../domain/target.ts"
import type { WorktreeCheckFailed, WorktreeRecordInvalid } from "../domain/worktree.ts"
import { clientEnvironment } from "../features/client-environment.ts"
import { allocationsInFallback } from "../features/admission.ts"
import { ownerOnly } from "../features/counting.ts"
import { defaultPolicy } from "../domain/policy.ts"
import { type Role, Roles } from "../domain/roles.ts"
import type { TarlatanConfig } from "../format/tarlatan-config.ts"
import { startTimeOf } from "../format/ps.ts"
import { readClientVersionWith } from "../runtime/client-version.ts"
import { pinnedGitWith, startGit } from "../runtime/git.ts"
import { openLedger } from "../runtime/ledger-sqlite.ts"
import { readProcesses } from "../runtime/processes.ts"
import { openProjectLog } from "../runtime/project-log.ts"
import { tryLock } from "../runtime/project-lock.ts"
import { startClientWith } from "../runtime/spawn.ts"
import { stateFiles } from "../runtime/state-files.ts"
import { publishClaudeProfileWith } from "./claude-profile.ts"
import { gitHomePath, preparedGitHome } from "./git-home.ts"
import { handoffGitWith, headWith } from "./handoff-git.ts"
import { ledgerDirOfTarget, settledTarget } from "./production-target.ts"
import { type SessionContext, UnreadAtHead, WorktreeUnready } from "./session-context.ts"
import { preparedStoreDirectories } from "./store-directory.ts"
import { requireBound, type TargetPolicy } from "./target-binding.ts"
import { worktreeProgramWith, type WorktreeProgram } from "./worktree.ts"

/** How long a log or ledger write waits for another writer, in milliseconds. */
export const busyTimeoutMillis = 5_000

/** The radix of the id parts: digits and lower-case letters. */
const idRadix = 36

/** The random part of an id is below this bound (2^31). */
const idRandomBound = 2_147_483_648

/**
 * Every role's grant estimate: the policy's `initialEstimate`, 15 points
 * (decision P5, batch review B10). The configuration cannot change it.
 */
export const initialEstimates: Readonly<Record<Role, number>> = {
  [Roles.Implementer]: defaultPolicy.initialEstimate,
  [Roles.Reviewer]: defaultPolicy.initialEstimate,
  [Roles.Corrector]: defaultPolicy.initialEstimate,
}

/** Everything a command runs with in production. */
export interface Production {
  readonly config: TarlatanConfig
  /** The target in force: the configured one, which the binding records. */
  readonly target: TargetBinding
  readonly context: SessionContext
  /** The supervisor worktree's creation and check, with the target's allowance. */
  readonly worktree: WorktreeProgram
}

/** The production factory's signature: the configuration file and tarlatan's own environment. */
export type ProductionFactory = (
  configPath: string,
  environment: Readonly<Record<string, string | undefined>>,
) => Effect.Effect<Production, unknown, Scope.Scope>

/**
 * The production capabilities of a command that acts on the target:
 * every launch and handoff, `worktree create`, `session open` and
 * `session close --finished`. It records the target binding at first use
 * and fails with `TargetMismatch` when the configuration names another
 * target (batch review B04). `environment` is tarlatan's own, from which a
 * client gets everything but `GIT_*` (decision P2). It settles the target
 * (production-target.ts): a recorded binding compared first, so a
 * mismatch creates nothing (owner finding F10), then the state and ledger
 * directories judged, then a missing one made, then a first binding
 * recorded. It then prepares git's HOME, opens the stores and wires every
 * capability; nothing else is opened, made or run before the target is
 * settled. A link to a
 * directory is followed, as the layout check follows it. A store
 * directory whose parent is missing, or whose resolved path is not a
 * directory, fails with `StoreDirectoryParentMissing` or
 * `StoreDirectoryRefused` (store-directory.ts). `status` and the owner's
 * exits have their own constructions, which never prepare git's HOME
 * (production-status.ts, production-exits.ts; re-review R02).
 */
export const production: ProductionFactory = (configPath, environment) =>
  Effect.gen(function* () {
    const { config, target } = yield* settledTarget(boundInPreparedState, configPath, environment)
    const { stateDir } = config
    const home = yield* preparedGitHome(gitHomePath(stateDir))
    const worktree = worktreeProgramWith(startGit, target.attributeAllowance)(home)
    const handoffGit = handoffGitWith(startGit, target.attributeAllowance)(home, stateDir)
    const parentEnvironment = Record.getSomes(Record.map(environment, Option.fromNullishOr))
    const context: SessionContext = {
      capabilities: {
        log: yield* openProjectLog(`${stateDir}/log.sqlite`, busyTimeoutMillis),
        ledger: yield* openLedger(target.ledger, busyTimeoutMillis),
        lock: tryLock(`${stateDir}/lock.sqlite`),
        startClient: startClientWith(readProcesses, startTimeOf),
        readProcesses,
        readClientVersion: readClientVersionWith({ cwd: stateDir, env: clientEnvironment(parentEnvironment) }),
        stateFiles,
        publishClaudeProfile: publishClaudeProfileWith(stateFiles, stateDir),
        checkWorktree: (recorded, base) => checkedHead({ worktree, home, handoffGit }, recorded, base),
        handoffGit,
        newId,
        nowMono: Effect.succeed(Option.none()),
        show: Console.log,
        parentEnvironment,
      },
      settings: {
        project: target.projectId,
        stateDir,
        pins: config.pins,
        estimates: initialEstimates,
        admission: { policy: defaultPolicy, retirement: ownerOnly, allocations: allocationsInFallback },
        checkCommands: config.checkCommands,
      },
    }
    return { config, target, context, worktree } satisfies Production
  })

/**
 * `requireBound` with the store directories prepared, in the order owner
 * finding F10 (dogfood-2) requires. It runs after `settledTarget` refused
 * a state directory that is not a directory (owner finding F2), compared
 * a recorded binding with the configured target and then checked the
 * configured layout, so a mismatch fails with `TargetMismatch`, and a
 * refused layout with `LayoutRefused`, before any directory is read for
 * creation or created. Here the state directory and the configured ledger
 * directory are both judged, and only then is a missing one whose parent
 * exists made, mode 0700 (dogfood-1 finding; owner finding F7). Last the
 * binding is recorded at first use, or compared again. A refused ledger
 * directory so leaves no state directory, binding or git HOME.
 */
const boundInPreparedState: TargetPolicy = (stateDir, configured) =>
  Effect.gen(function* () {
    yield* preparedStoreDirectories([stateDir, ledgerDirOfTarget(configured)])
    return yield* requireBound(stateDir, configured)
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

/** What the startup check runs over: the worktree entry points, git's HOME and the handoff's git work. */
export interface StartupGit {
  /** The worktree entry points, judging attributes under the target's allowance. */
  readonly worktree: WorktreeProgram
  /** Git's private HOME, already judged usable. */
  readonly home: string
  /** The handoff's git work, whose attribute check judges the base. */
  readonly handoffGit: ReturnType<ReturnType<typeof handoffGitWith>>
}

/**
 * The startup check (`identifyWorktree`), then the worktree's HEAD read
 * through the runner pinned to the record (plan B11d) and decoded, then
 * the attribute check on `base`, or on that HEAD when `base` is none
 * (batch review B07). It returns the HEAD and never compares it with
 * `base`: a HEAD that moved from the session's base is the command
 * rules' `HeadMoved` refusal (owner ruling of 2026-11-23, which replaced
 * B07's launch on a moved HEAD), and `status` reports it as a finding.
 * `status` runs the same check (production-status.ts).
 * A judgment that the worktree is unready (`WorktreeCheckFailed`,
 * `WorktreeRecordInvalid`, `AttributeSourcesRefused`) becomes
 * `WorktreeUnready`. When the worktree was identified and only its
 * attribute sources are refused, that `WorktreeUnready` keeps the HEAD
 * read, so the rules and `status` still see a moved HEAD (owner finding
 * F2, dogfood-3a round 1). A check that could not run keeps its own failure
 * (`WorktreeCheckUnrun`, review item R01), and a HEAD that does not decode
 * is `GitOutputUndecodable`. A HEAD read that fails keeps its failure
 * whatever the attribute check found (owner finding F2, round 2). An
 * unread attribute source judges nothing (owner ruling on B11c and R01):
 * after a HEAD read it is `UnreadAtHead`, which every command but `status`
 * turns back into its `AttributeSourcesUnread` (owner finding F3).
 */
export const checkedHead = (git: StartupGit, recorded: WorktreeCreated, base: Option.Option<Revision>) =>
  Effect.gen(function* () {
    const found = yield* identified(git, recorded)
    const head = yield* headWith(pinnedGitWith(startGit)(git.home)(recorded), recorded.path)
    if (Option.isSome(found)) {
      return yield* besideHead(head)(found.value)
    }
    const judged = git.handoffGit(recorded).checkAttributes(Option.getOrElse(base, () => head))
    yield* Effect.catchTags(judged, { AttributeSourcesRefused: besideHead(head), AttributeSourcesUnread: besideHead(head) })
    return head
  })

/**
 * `identifyWorktree`, with the worktree judged unready when it is not
 * identified. Attribute sources it refused or could not read are returned,
 * so `checkedHead` still reads the HEAD (owner findings F2 and F3).
 */
const identified = (git: StartupGit, recorded: WorktreeCreated) =>
  Effect.catchTags(
    Effect.as(git.worktree.identifyWorktree(recorded), Option.none<AttributeSourcesRefused | AttributeSourcesUnread>()),
    {
      WorktreeCheckFailed: unready(Option.none()),
      WorktreeRecordInvalid: unready(Option.none()),
      AttributeSourcesRefused: (refused) => Effect.succeed(Option.some(refused)),
      AttributeSourcesUnread: (unread) => Effect.succeed(Option.some(unread)),
    },
  )

/** An attribute check that did not pass after `head` was read: `WorktreeUnready` or `UnreadAtHead`, each with `head`. */
const besideHead =
  (head: Revision) =>
  (found: AttributeSourcesRefused | AttributeSourcesUnread): Effect.Effect<never, WorktreeUnready | UnreadAtHead> =>
    Schema.is(AttributeSourcesUnread)(found)
      ? Effect.fail(new UnreadAtHead({ unread: found, head }))
      : unready(Option.some(head))(found)

/** A judgment that the worktree is unready, with the judgment as its reason and the HEAD read, if any. */
const unready =
  (head: Option.Option<Revision>) => (judgment: WorktreeCheckFailed | WorktreeRecordInvalid | AttributeSourcesRefused) =>
    Effect.fail(new WorktreeUnready({ reason: Formatter.formatJson(judgment), head }))
