// What every assisted-session command runs over (plan "Injected
// capabilities"): the capabilities Program receives, never chooses by a
// flag, and the settings from the configuration. Production builds them
// in production.ts; a test passes its own, such as a fake `StartClient`.
import { Schema } from "effect"
import type { Effect, Option, Scope } from "effect"
import type { AttributeSourcesRefused } from "../domain/attributes.ts"
import type { Client } from "../domain/clients.ts"
import type { MonoStamp } from "../domain/clock.ts"
import type { LockHeld, ProjectLog, ProjectLogError, WorktreeCreated } from "../domain/events.ts"
import type { ProjectId, Revision } from "../domain/ids.ts"
import type { LedgerStore } from "../domain/ledger.ts"
import type { Role } from "../domain/roles.ts"
import type { RecordedGitIdentity } from "../domain/session.ts"
import type {
  SnapshotIndexFailed,
  SnapshotObjectFormatRefused,
  SnapshotPreflightRefused,
  SnapshotRefused,
  SnapshotStepFailed,
} from "../domain/snapshot.ts"
import type { GitCommandFailed } from "../domain/worktree.ts"
import type { AdmissionContext } from "../features/admission.ts"
import type { ReadClientVersion } from "../runtime/client-version.ts"
import type { GitOutput } from "../runtime/git.ts"
import type { ReadProcesses } from "../runtime/processes.ts"
import type { StartClient } from "../runtime/spawn.ts"
import type { StateFiles } from "../runtime/state-files.ts"
import type { PublishClaudeProfile } from "./claude-profile.ts"

/**
 * The startup worktree check (plans B11a to B11d) did not pass for the
 * recorded worktree, or its HEAD could not be read; `reason` says why.
 */
export class WorktreeUnready extends Schema.TaggedError<WorktreeUnready>()("WorktreeUnready", {
  reason: Schema.String,
}) {}

/**
 * Runs the startup worktree check on the recorded supervisor worktree and
 * returns its HEAD. Production runs `identifyWorktree` and then `git
 * rev-parse HEAD` through the runner pinned to the record.
 */
export type CheckWorktree = (recorded: WorktreeCreated) => Effect.Effect<Revision, WorktreeUnready>

/**
 * Why a snapshot was not taken: refused before staging
 * (`SnapshotPreflightRefused`, review finding B08), or refused by the raw
 * checks (`SnapshotRefused`).
 */
export type SnapshotFailure =
  | SnapshotObjectFormatRefused
  | SnapshotPreflightRefused
  | SnapshotRefused
  | SnapshotStepFailed
  | SnapshotIndexFailed
  | GitCommandFailed

/** Why the handoff's attribute check or snapshot stopped a command. */
export type HandoffGitFailure = AttributeSourcesRefused | SnapshotFailure

/**
 * The git work of a handoff (plan "Write protocol", step 2; "Snapshot
 * identity and raw checks"), in the supervisor worktree with git pinned
 * to the session's recorded identity (plan B11d). Program calls it only
 * after the owner's attestation and every other prerequisite passed, so
 * nothing is staged before them.
 */
export interface HandoffGit {
  /** The attribute-source check (plan B11c) again, against `base`. */
  readonly checkAttributes: (base: Revision) => Effect.Effect<void, AttributeSourcesRefused | GitCommandFailed>
  /** The snapshot from `base`: its tree when every entry passes the raw checks. */
  readonly snapshot: (base: Revision) => Effect.Effect<Revision, SnapshotFailure>
  /** The raw run of `git diff-tree -r -z --name-status <base> <tree>`. */
  readonly changedPaths: (base: Revision, tree: Revision) => Effect.Effect<GitOutput, GitCommandFailed>
}

/** The capabilities a session command runs over. */
export interface SessionCapabilities {
  readonly log: ProjectLog
  readonly ledger: LedgerStore
  /** Takes the project lock for the scope, or fails at once with `LockHeld`. */
  readonly lock: Effect.Effect<void, LockHeld | ProjectLogError, Scope.Scope>
  readonly startClient: StartClient
  readonly readProcesses: ReadProcesses
  readonly readClientVersion: ReadClientVersion
  readonly stateFiles: StateFiles
  /** Publishes Claude's editing profile for a worktree, before admission (batch review B03). */
  readonly publishClaudeProfile: PublishClaudeProfile
  readonly checkWorktree: CheckWorktree
  /** The handoff's git work for a session's recorded worktree. */
  readonly handoffGit: (identity: RecordedGitIdentity) => HandoffGit
  /** A fresh identifier slug for a session, operation, grant or waiver. */
  readonly newId: Effect.Effect<string>
  /** The monotonic clock now; none while no clock mechanism exists (design O11). */
  readonly nowMono: Effect.Effect<Option.Option<MonoStamp>>
  /** Shows one line of a client's output to the owner as it arrives. */
  readonly show: (line: string) => Effect.Effect<void>
  /** Foreman's own environment; a client gets it minus every `GIT_*` variable (decision P2). */
  readonly parentEnvironment: Readonly<Record<string, string>>
}

/** The settings a session command reads, from the configuration. */
export interface SessionSettings {
  readonly project: ProjectId
  /** Where published state files go: task copies, raw output and handoffs. */
  readonly stateDir: string
  /** Each client's pinned `--version` output, trimmed (decision P4). */
  readonly pins: Readonly<Record<Client, string>>
  /** Each role's grant estimate in points (decision P5). */
  readonly estimates: Readonly<Record<Role, number>>
  readonly admission: AdmissionContext
}

/** A session command's capabilities and settings. */
export interface SessionContext {
  readonly capabilities: SessionCapabilities
  readonly settings: SessionSettings
}
