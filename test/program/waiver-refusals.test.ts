// The one-attempt waiver rule against every kind of stop (design
// "Waivers"; review items B15 and R01). A launch attempt that a
// deliberate refusal stops before `Intended` expires every armed waiver:
// a changed task file, a task that is not UTF-8, an unreadable findings
// file, an unsafe profile path, a refused check command, refused attribute sources and a snapshot
// preflight refusal, as well as the rules' own refusals. A storage failure or a crash expires
// nothing, so the retry after batch W still launches with its waiver.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Effect, Exit, Option, Schema } from "effect"
import { spawnSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { AttributeSourcesRefused } from "../../src/domain/attributes.ts"
import { type Client, Clients } from "../../src/domain/clients.ts"
import { type ProjectEvent, SessionOpened, Waived, WaiverExpired } from "../../src/domain/events.ts"
import { WaiverId } from "../../src/domain/ids.ts"
import type { RecordedGitIdentity } from "../../src/domain/session.ts"
import { SnapshotPreflightRefused } from "../../src/domain/snapshot.ts"
import { CheckCommandRefused, ProfilePathUnsafe } from "../../src/format/claude-settings.ts"
import { correct } from "../../src/program/correct.ts"
import { implement } from "../../src/program/implement.ts"
import { review } from "../../src/program/review.ts"
import { FileNotUtf8, FindingsFileUnreadable, TaskFileChanged } from "../../src/program/session-errors.ts"
import { StateFileFailed } from "../../src/runtime/state-files.ts"
import { afterFindings, afterImplement } from "./handoff-steps.ts"
import { eventsOf, type Harness, repositoryHarnessMillis, withHarness } from "./session-harness.ts"
import { append, failsWith, intendedOf, opened, quotaHold } from "./session-steps.ts"

const waiverOf: Readonly<Record<Client, WaiverId>> = {
  [Clients.Claude]: WaiverId.make("w-claude"),
  [Clients.Codex]: WaiverId.make("w-codex"),
}

/** Arms `provider`'s waiver under its quota hold, as a command that stopped after batch W leaves it. */
const armed = (harness: Harness, provider: Client) =>
  append(harness, [quotaHold(provider), new Waived({ provider, waiverId: waiverOf[provider] })])

/** The `WaiverExpired` events in the log. */
const expiredOf = (harness: Harness) =>
  Effect.map(eventsOf(harness), (events) => Arr.filter(events, Schema.is(WaiverExpired)))

/** The open session's recorded task copy. */
const taskCopyOf = (harness: Harness) =>
  Effect.flatMap(eventsOf(harness), (events: ReadonlyArray<ProjectEvent>) =>
    Effect.fromOption(Option.map(Arr.findLast(events, Schema.is(SessionOpened)), (event) => event.taskPath)),
  )

/**
 * Runs `attempt`, which must fail with an error `guard` accepts without
 * launching, and requires that it expired `provider`'s armed waiver.
 */
const expiresWaiver = (
  harness: Harness,
  provider: Client,
  attempt: Effect.Effect<unknown, unknown>,
  guard: (error: unknown) => boolean,
) =>
  Effect.gen(function* () {
    const launches = harness.client.launches.length
    failsWith(yield* Effect.exit(attempt), guard)
    expect(harness.client.launches.length).toBe(launches)
    expect(yield* expiredOf(harness)).toEqual([new WaiverExpired({ waiverId: waiverOf[provider] })])
  })

/** Runs `attempt`, which must fail with an error `guard` accepts, and requires that no waiver expired. */
const keepsWaiver = (attempt: Effect.Effect<unknown, unknown>, guard: (error: unknown) => boolean) =>
  Effect.gen(function* () {
    failsWith(yield* Effect.exit(attempt), guard)
  })

/** `review` without `--waive`, attested. */
const reviewNow = (harness: Harness) => review(harness.context, { waive: false, attest: true })

/** Creates a FIFO at `path`. */
const makeFifo = (path: string) => {
  expect(spawnSync("/usr/bin/mkfifo", [path], { encoding: "utf8" }).status).toBe(0)
}

/** A context whose profile publication fails with `ProfilePathUnsafe`. */
const unsafeProfile = (harness: Harness) => ({
  ...harness.context,
  capabilities: {
    ...harness.context.capabilities,
    publishClaudeProfile: (identity: RecordedGitIdentity) => Effect.fail(new ProfilePathUnsafe({ path: identity.path })),
  },
})

/** A context whose profile publication crashes with a defect. */
const crashingProfile = (harness: Harness) => ({
  ...harness.context,
  capabilities: { ...harness.context.capabilities, publishClaudeProfile: () => Effect.die("crashed") },
})

const changedTask = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    yield* armed(harness, Clients.Claude)
    writeFileSync(yield* taskCopyOf(harness), "Something else.\n")
    yield* expiresWaiver(harness, Clients.Claude, implement(harness.context, { waive: false }), Schema.is(TaskFileChanged))
  })

const taskNotUtf8 = (harness: Harness) =>
  Effect.gen(function* () {
    writeFileSync(harness.taskFile, new Uint8Array([0x41, 0xff, 0x0a]))
    yield* opened(harness)
    yield* armed(harness, Clients.Claude)
    yield* expiresWaiver(harness, Clients.Claude, implement(harness.context, { waive: false }), Schema.is(FileNotUtf8))
  })

const textAttributes = (harness: Harness) =>
  Effect.gen(function* () {
    yield* afterImplement(harness)
    yield* armed(harness, Clients.Codex)
    writeFileSync(`${harness.worktree.path}/.gitattributes`, "* text\n")
    yield* expiresWaiver(harness, Clients.Codex, reviewNow(harness), Schema.is(AttributeSourcesRefused))
  })

const preflightRefused = (harness: Harness) =>
  Effect.gen(function* () {
    yield* afterImplement(harness)
    yield* armed(harness, Clients.Codex)
    makeFifo(`${harness.worktree.path}/pipe`)
    yield* expiresWaiver(harness, Clients.Codex, reviewNow(harness), Schema.is(SnapshotPreflightRefused))
  })

const findingsMissing = (harness: Harness) =>
  Effect.gen(function* () {
    yield* afterFindings(harness)
    yield* armed(harness, Clients.Claude)
    const missing = correct(harness.context, { findingsFile: `${harness.dir}/absent.md`, waive: false, attest: true })
    yield* expiresWaiver(harness, Clients.Claude, missing, Schema.is(FindingsFileUnreadable))
  })

const profileRefused = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    yield* armed(harness, Clients.Claude)
    const attempt = implement(unsafeProfile(harness), { waive: false })
    yield* expiresWaiver(harness, Clients.Claude, attempt, Schema.is(ProfilePathUnsafe))
  })

/**
 * A context whose settings name a check command the profile refuses, as a
 * configuration that bypassed decoding would; the harness publishes the
 * profile with production's renderer.
 */
const refusedCheckCommand = (harness: Harness) => ({
  ...harness.context,
  settings: { ...harness.context.settings, checkCommands: ["bun run verify", "git commit"] },
})

const checkCommandRefused = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    yield* armed(harness, Clients.Claude)
    const attempt = implement(refusedCheckCommand(harness), { waive: false })
    yield* expiresWaiver(harness, Clients.Claude, attempt, Schema.is(CheckCommandRefused))
  })

/** The retry after a stop that expired nothing: it launches with Claude's armed waiver. */
const retryUsesWaiver = (harness: Harness) =>
  Effect.gen(function* () {
    expect(yield* expiredOf(harness)).toEqual([])
    yield* implement(harness.context, { waive: false })
    const [intent] = yield* intendedOf(harness)
    expect(intent?.waiverId).toEqual(Option.some(waiverOf[Clients.Claude]))
    expect(harness.client.launches.length).toBe(1)
  })

const storageFailureKeeps = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    yield* armed(harness, Clients.Claude)
    harness.inject.publishFails = Option.some((path) => path.endsWith(".brief.md"))
    yield* keepsWaiver(implement(harness.context, { waive: false }), Schema.is(StateFileFailed))
    yield* retryUsesWaiver(harness)
  })

const crashKeeps = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    yield* armed(harness, Clients.Claude)
    const exit = yield* Effect.exit(implement(crashingProfile(harness), { waive: false }))
    expect(Exit.hasDies(exit)).toBe(true)
    yield* retryUsesWaiver(harness)
  })

describe("a deliberate refusal before Intended expires every armed waiver", () => {
  it.effect("a changed task file, with Claude's waiver armed", () => withHarness({}, changedTask))
  it.effect("a task that is not UTF-8, with Claude's waiver armed", () => withHarness({}, taskNotUtf8))
  it.effect("`* text` added before review, with Codex's waiver armed", () =>
    withHarness({ repository: true }, textAttributes), repositoryHarnessMillis,
  )
  it.effect("a snapshot preflight refusal, with Codex's waiver armed", () =>
    withHarness({ repository: true }, preflightRefused), repositoryHarnessMillis,
  )
  it.effect("an unreadable findings file, with Claude's waiver armed", () =>
    withHarness({ repository: true }, findingsMissing), repositoryHarnessMillis,
  )
  it.effect("an unsafe profile path, with Claude's waiver armed", () => withHarness({}, profileRefused))
  it.effect("a refused check command, with Claude's waiver armed", () => withHarness({}, checkCommandRefused))
})

describe("a storage failure or a crash expires nothing", () => {
  it.effect("a failed brief publication keeps the waiver for the retry", () => withHarness({}, storageFailureKeeps))
  it.effect("a crash keeps the waiver for the retry", () => withHarness({}, crashKeeps))
})
