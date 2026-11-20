// What every assisted-session command runs over (plan "Injected
// capabilities"): the capabilities Program receives, never chooses by a
// flag, and the settings from the configuration. Production builds them
// in production.ts; a test passes its own, such as a fake `StartClient`.
import { Schema } from "effect"
import type { Effect, Option, Scope } from "effect"
import type { Client } from "../domain/clients.ts"
import type { MonoStamp } from "../domain/clock.ts"
import type { LockHeld, ProjectLog, ProjectLogError, WorktreeCreated } from "../domain/events.ts"
import type { ProjectId, Revision } from "../domain/ids.ts"
import type { LedgerStore } from "../domain/ledger.ts"
import type { Role } from "../domain/roles.ts"
import type { AdmissionContext } from "../features/admission.ts"
import type { ReadClientVersion } from "../runtime/client-version.ts"
import type { ReadProcesses } from "../runtime/processes.ts"
import type { StartClient } from "../runtime/spawn.ts"
import type { StateFiles } from "../runtime/state-files.ts"

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
  readonly checkWorktree: CheckWorktree
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
  /** The settings file of Claude's editing profile. */
  readonly claudeSettings: string
  /** Each role's grant estimate in points (decision P5). */
  readonly estimates: Readonly<Record<Role, number>>
  readonly admission: AdmissionContext
}

/** A session command's capabilities and settings. */
export interface SessionContext {
  readonly capabilities: SessionCapabilities
  readonly settings: SessionSettings
}
