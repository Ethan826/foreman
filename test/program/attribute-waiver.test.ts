// The attribute check against the one-attempt waiver rule (owner ruling
// on B11c and R01, 2026-11-20). An attribute source that cannot be read
// still stops the launch. When the failed read is the only reason to
// stop, the stop keeps git's or the file system's diagnostic and every
// armed waiver stays armed. A source that was read and is refused
// expires the waiver even when another source could not be read. Both
// hold at startup, where production's check runs inside the recorded
// worktree, and in the handoff's candidate check before `review`.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Effect, Exit, Option, Schema } from "effect"
import { chmodSync, mkdirSync, writeFileSync } from "node:fs"
import { AttributeRefusalReasons, AttributeSources, noAttributeAllowance } from "../../src/domain/attributes.ts"
import { type Client, Clients } from "../../src/domain/clients.ts"
import { Waived, WaiverExpired } from "../../src/domain/events.ts"
import { WaiverId } from "../../src/domain/ids.ts"
import { handoffGitWith } from "../../src/program/handoff-git.ts"
import { implement } from "../../src/program/implement.ts"
import { checkedHead } from "../../src/program/production.ts"
import { review } from "../../src/program/review.ts"
import type { SessionContext } from "../../src/program/session-context.ts"
import { worktreeProgramWith } from "../../src/program/worktree.ts"
import { startGit, type StartGit } from "../../src/runtime/git.ts"
import { emptyHome, git } from "../runtime/git-repo.ts"
import { afterImplement } from "./handoff-steps.ts"
import { eventsOf, type Harness, withHarness } from "./session-harness.ts"
import { append, opened, quotaHold } from "./session-steps.ts"

const waiverOf: Readonly<Record<Client, WaiverId>> = {
  [Clients.Claude]: WaiverId.make("w-claude"),
  [Clients.Codex]: WaiverId.make("w-codex"),
}

/** No permission bits: the file cannot be read. */
const unreadableMode = 0o000

/** Owner read and write; group and others read. */
const readableMode = 0o644

/** The stderr of a `cat-file` made to fail. */
const catFileDiagnostic = "fatal: cat-file made to fail\n"

/** Arms `provider`'s waiver under its quota hold, as a command that stopped after batch W leaves it. */
const armed = (harness: Harness, provider: Client) =>
  append(harness, [quotaHold(provider), new Waived({ provider, waiverId: waiverOf[provider] })])

/** The `WaiverExpired` events in the log. */
const expiredOf = (harness: Harness) =>
  Effect.map(eventsOf(harness), (events) => Arr.filter(events, Schema.is(WaiverExpired)))

/** The typed failure `attempt` stopped with, if any. */
const stopOf = (attempt: Effect.Effect<unknown, unknown>) =>
  Effect.map(Effect.exit(attempt), (exit) => (Exit.isFailure(exit) ? Option.getOrUndefined(Exit.findErrorOption(exit)) : undefined))

/** `harness`'s context with production's startup check, over real git. */
const checkedOver = (harness: Harness): SessionContext => {
  const startup = {
    worktree: worktreeProgramWith(startGit, noAttributeAllowance)(emptyHome),
    home: emptyHome,
    handoffGit: handoffGitWith(startGit, noAttributeAllowance)(emptyHome, harness.dir),
  }
  return {
    ...harness.context,
    capabilities: {
      ...harness.context.capabilities,
      checkWorktree: (recorded, base) => checkedHead(startup, recorded, base),
    },
  }
}

/** `harness`'s context whose handoff git runs over `start`. */
const handoffOver = (harness: Harness, start: StartGit): SessionContext => ({
  ...harness.context,
  capabilities: {
    ...harness.context.capabilities,
    handoffGit: handoffGitWith(start, noAttributeAllowance)(emptyHome, harness.dir),
  },
})

/** Real git, except that `cat-file` of `object` exits 128. */
const catFileFailingFor =
  (object: string): StartGit =>
  (invocation) =>
    Arr.contains(invocation.args, "cat-file") && Arr.contains(invocation.args, object)
      ? Effect.succeed({ exitCode: 128, stdout: "", stderr: catFileDiagnostic })
      : startGit(invocation)

/** Runs `body` with the repository's `info/attributes` present but unreadable, restoring it afterwards. */
const withUnreadableInfo = <A, E>(harness: Harness, body: Effect.Effect<A, E>) => {
  const path = `${harness.worktree.commonDir}/info/attributes`
  return Effect.ensuring(
    Effect.andThen(
      Effect.sync(() => {
        writeFileSync(path, "")
        chmodSync(path, unreadableMode)
      }),
      body,
    ),
    Effect.sync(() => {
      chmodSync(path, readableMode)
    }),
  )
}

/** Opens a session, arms Claude's waiver and runs `implement` with production's startup check. */
const implementChecked = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    yield* armed(harness, Clients.Claude)
    return yield* stopOf(implement(checkedOver(harness), { waive: false }))
  })

const startupUnreadKeeps = (harness: Harness) =>
  Effect.gen(function* () {
    const stop = yield* withUnreadableInfo(harness, implementChecked(harness))
    expect(stop).toMatchObject({
      _tag: "AttributeSourcesUnread",
      failures: [{ source: AttributeSources.InfoAttributes, reason: AttributeRefusalReasons.ReadFailed }],
    })
    expect(yield* expiredOf(harness)).toEqual([])
    expect(harness.client.launches.length).toBe(0)
  })

const startupRefusalExpires = (harness: Harness) =>
  Effect.gen(function* () {
    yield* git(harness.worktree.path, "config", "core.attributesFile", `${harness.dir}/attributes`)
    const stop = yield* withUnreadableInfo(harness, implementChecked(harness))
    expect(stop).toMatchObject({ _tag: "CommandRefused" })
    expect(yield* expiredOf(harness)).toEqual([new WaiverExpired({ waiverId: waiverOf[Clients.Claude] })])
    expect(harness.client.launches.length).toBe(0)
  })

/** Writes an inert nested `.gitattributes` into the worktree and returns its blob's object id. */
const plantUnreadableBlob = (harness: Harness) =>
  Effect.gen(function* () {
    mkdirSync(`${harness.worktree.path}/a`)
    writeFileSync(`${harness.worktree.path}/a/.gitattributes`, "# unreadable\n")
    return yield* git(harness.worktree.path, "hash-object", "a/.gitattributes")
  })

/**
 * After `implement`, arms Codex's waiver, writes `rootAttributes` (if any)
 * as the worktree's root `.gitattributes`, and runs `review` over a
 * handoff whose `cat-file` of the planted blob fails. Requires that review
 * launched nothing.
 */
const reviewOverUnreadableBlob = (harness: Harness, rootAttributes: Option.Option<string>) =>
  Effect.gen(function* () {
    yield* afterImplement(harness)
    yield* armed(harness, Clients.Codex)
    yield* Effect.forEach(Option.toArray(rootAttributes), (content) =>
      Effect.sync(() => {
        writeFileSync(`${harness.worktree.path}/.gitattributes`, content)
      }),
    )
    const object = yield* plantUnreadableBlob(harness)
    const launches = harness.client.launches.length
    const stop = yield* stopOf(review(handoffOver(harness, catFileFailingFor(object)), { waive: false, attest: true }))
    expect(harness.client.launches.length).toBe(launches)
    return stop
  })

/** The failed `cat-file` of the planted blob, as the check lists it. */
const blobReadFailed = {
  source: AttributeSources.Tree,
  reason: AttributeRefusalReasons.ReadFailed,
  path: Option.some("a/.gitattributes"),
  detail: `exit 128: ${catFileDiagnostic}`,
}

const candidateUnreadKeeps = (harness: Harness) =>
  Effect.gen(function* () {
    const stop = yield* reviewOverUnreadableBlob(harness, Option.none())
    expect(stop).toMatchObject({ _tag: "AttributeSourcesUnread", failures: [blobReadFailed] })
    expect(yield* expiredOf(harness)).toEqual([])
  })

const candidateRefusalExpires = (harness: Harness) =>
  Effect.gen(function* () {
    const stop = yield* reviewOverUnreadableBlob(harness, Option.some("* text\n"))
    expect(stop).toMatchObject({
      _tag: "AttributeSourcesRefused",
      refusals: [{ source: AttributeSources.Tree, reason: AttributeRefusalReasons.Content, detail: "* text" }, blobReadFailed],
    })
    expect(yield* expiredOf(harness)).toEqual([new WaiverExpired({ waiverId: waiverOf[Clients.Codex] })])
  })

describe("a failed attribute read that is the only reason to stop keeps the waiver", () => {
  it.effect("at startup, an unreadable info/attributes stops implement as unread", () =>
    withHarness({ repository: true }, startupUnreadKeeps),
  )
  it.effect("in the candidate check, a cat-file that exits non-zero stops review as unread", () =>
    withHarness({ repository: true }, candidateUnreadKeeps),
  )
})

describe("a refused source that was read expires the waiver beside a failed read", () => {
  it.effect("at startup, a configured core.attributesFile beside an unreadable info/attributes", () =>
    withHarness({ repository: true }, startupRefusalExpires),
  )
  it.effect("in the candidate check, `* text` beside a blob that could not be read", () =>
    withHarness({ repository: true }, candidateRefusalExpires),
  )
})
