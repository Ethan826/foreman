// The one-attempt waiver rule (design "Waivers"; review item B15): a
// waiver is armed until the next launch attempt, which uses it when it
// launches the waived provider's step and otherwise expires it. So an
// attempt that launches Claude expires Codex's armed waiver in batch I,
// and an attempt that is refused, for quota or any other reason, expires
// every armed waiver after its refusal. The retry after batch W still
// uses its own armed waiver, and close expires what is left.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Effect, Option, Schema } from "effect"
import { Clients } from "../../src/domain/clients.ts"
import { type ProjectEvent, Waived, WaiverExpired } from "../../src/domain/events.ts"
import { WaiverId } from "../../src/domain/ids.ts"
import { CloseKinds } from "../../src/domain/session.ts"
import { foldSession } from "../../src/features/session.ts"
import { implement } from "../../src/program/implement.ts"
import { CommandRefused, QuotaHeld, WaiverRefused } from "../../src/program/session-errors.ts"
import { closeSession } from "../../src/program/session.ts"
import { eventsOf, type Harness, logBatch, withHarness } from "./session-harness.ts"
import { append, failsWith, failureHold, intendedOf, opened, quotaHold } from "./session-steps.ts"

const codexWaiver = WaiverId.make("w-codex")
const claudeWaiver = WaiverId.make("w-claude")

/** Opens a session with Codex's waiver armed, as a Codex command that stopped after batch W leaves it. */
const withCodexWaiver = (harness: Harness, more: ReadonlyArray<ProjectEvent> = []) =>
  Effect.andThen(
    opened(harness),
    append(harness, [quotaHold(Clients.Codex), new Waived({ provider: Clients.Codex, waiverId: codexWaiver }), ...more]),
  )

/** The armed waivers the log leaves. */
const armedNow = (harness: Harness) => Effect.map(eventsOf(harness), (events) => foldSession(events).armedWaivers)

/** The events appended after `before`. */
const appendedSince = (harness: Harness, before: ReadonlyArray<ProjectEvent>) =>
  Effect.map(eventsOf(harness), (events) => Arr.drop(events, Arr.length(before)))

const admittedExpiresOther = (harness: Harness) =>
  Effect.gen(function* () {
    yield* withCodexWaiver(harness)
    yield* implement(harness.context, { waive: false })
    expect(harness.trace[1]).toMatchObject(logBatch("Intended", "WaiverExpired"))
    expect(Arr.filter(yield* eventsOf(harness), Schema.is(WaiverExpired))).toEqual([
      new WaiverExpired({ waiverId: codexWaiver }),
    ])
    expect((yield* armedNow(harness))[Clients.Codex]).toEqual(Option.none())
  })

const refusedExpires = (
  setup: ReadonlyArray<ProjectEvent>,
  waive: boolean,
  guard: (error: unknown) => boolean,
  expected: ReadonlyArray<string>,
) => (harness: Harness) =>
  Effect.gen(function* () {
    yield* withCodexWaiver(harness, setup)
    const before = yield* eventsOf(harness)
    failsWith(yield* Effect.exit(implement(harness.context, { waive })), guard)
    const appended = yield* appendedSince(harness, before)
    expect(appended).toHaveLength(expected.length)
    expect(appended).toMatchObject(expected.map((tag) => ({ _tag: tag })))
    expect(Arr.filter(yield* eventsOf(harness), Schema.is(WaiverExpired))).toEqual([
      new WaiverExpired({ waiverId: codexWaiver }),
    ])
    expect(harness.client.launches).toEqual([])
  })

const waiveAcceptedAfterExpiry = (harness: Harness) =>
  Effect.gen(function* () {
    yield* withCodexWaiver(harness)
    failsWith(yield* Effect.exit(implement(harness.context, { waive: true })), Schema.is(WaiverRefused))
    yield* implement(harness.context, { waive: true })
    const [intent] = yield* intendedOf(harness)
    expect(Option.isSome(intent?.waiverId ?? Option.none())).toBe(true)
    expect(harness.client.launches.length).toBe(1)
  })

const refusedRetryExpiresOwn = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    yield* append(harness, [
      quotaHold(Clients.Claude),
      new Waived({ provider: Clients.Claude, waiverId: claudeWaiver }),
      failureHold,
    ])
    failsWith(yield* Effect.exit(implement(harness.context, { waive: false })), Schema.is(CommandRefused))
    expect(Arr.filter(yield* eventsOf(harness), Schema.is(WaiverExpired))).toEqual([
      new WaiverExpired({ waiverId: claudeWaiver }),
    ])
  })

const closeExpiresOther = (harness: Harness) =>
  Effect.gen(function* () {
    yield* withCodexWaiver(harness)
    yield* closeSession(harness.context, { how: CloseKinds.Abandoned, note: "" })
    expect(Arr.filter(yield* eventsOf(harness), Schema.is(WaiverExpired))).toEqual([
      new WaiverExpired({ waiverId: codexWaiver }),
    ])
    expect((yield* armedNow(harness))[Clients.Codex]).toEqual(Option.none())
  })

describe("an attempt that does not launch the waived provider expires its waiver", () => {
  it.effect("an admitted Claude attempt expires Codex's armed waiver in batch I", () =>
    withHarness({}, admittedExpiresOther),
  )
  it.effect("a Claude attempt refused for quota without --waive expires it after batch Q", () =>
    withHarness({ allowing: false }, refusedExpires([], false, Schema.is(QuotaHeld), ["HoldCreated", "WaiverExpired"])),
  )
  it.effect("a refused --waive expires it after batch Q, so the next --waive is accepted", () =>
    withHarness({ allowing: false }, waiveAcceptedAfterExpiry),
  )
  it.effect("a non-quota refusal expires it and writes nothing else", () =>
    withHarness({}, refusedExpires([failureHold], false, Schema.is(CommandRefused), ["WaiverExpired"])),
  )
  it.effect("a refused retry after batch W expires the provider's own armed waiver", () =>
    withHarness({}, refusedRetryExpiresOwn),
  )
  it.effect("close expires another provider's armed waiver", () => withHarness({}, closeExpiresOther))
})

const nothingBeyondQ = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    failsWith(yield* Effect.exit(implement(harness.context, { waive: false })), Schema.is(QuotaHeld))
    expect(harness.trace).toMatchObject([logBatch("HoldCreated")])
    expect(harness.trace).toHaveLength(1)
  })

describe("refusals with no armed waiver", () => {
  it.effect("write nothing beyond batch Q", () => withHarness({ allowing: false }, nothingBeyondQ))
})
