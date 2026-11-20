// Shared steps and assertions of the session Program tests: opening a
// session, appending events directly, the holds the tests plant, and
// checks on a command's failure.
import { expect } from "@effect/vitest"
import { Array as Arr, Effect, Exit, Option, Schema } from "effect"
import type { Client } from "../../src/domain/clients.ts"
import { HoldCreated, Intended, LogPosition, type ProjectEvent, Waived } from "../../src/domain/events.ts"
import { Failure, Quota } from "../../src/domain/holds.ts"
import { LedgerSeq, OpId, TrancheId } from "../../src/domain/ids.ts"
import { Unclassified } from "../../src/domain/outcomes.ts"
import { openSession } from "../../src/program/session.ts"
import { CommandRefused } from "../../src/program/session-errors.ts"
import { eventsOf, type Harness } from "./session-harness.ts"

export const tranche = TrancheId.make("t-1")

/** Opens a session on the harness's task. */
export const open = (harness: Harness) => openSession(harness.context, { tranche, taskFile: harness.taskFile })

/** Opens a session, then forgets the trace so far. */
export const opened = (harness: Harness) =>
  Effect.gen(function* () {
    yield* open(harness)
    harness.trace.length = 0
  })

/** Appends `events` at the log's end as one batch, then forgets the trace so far. */
export const append = (harness: Harness, events: ReadonlyArray<ProjectEvent>) =>
  Effect.gen(function* () {
    const position = Arr.length(yield* eventsOf(harness))
    yield* harness.context.capabilities.log.append(LogPosition.make(position), events)
    harness.trace.length = 0
  })

/** A quota hold of `provider` naming no window. */
export const quotaHold = (provider: Client) =>
  new HoldCreated({
    hold: new Quota({ provider, windows: [], heldMono: Option.none(), ledgerSeq: LedgerSeq.make(1) }),
  })

/** A failure hold, which blocks every launch. */
export const failureHold = new HoldCreated({
  hold: new Failure({ opId: OpId.make("op-0"), outcome: new Unclassified() }),
})

/** The `Intended` events in the log. */
export const intendedOf = (harness: Harness) =>
  Effect.map(eventsOf(harness), (events) => Arr.filter(events, Schema.is(Intended)))

/** The `Waived` events in the log. */
export const waivedOf = (harness: Harness) =>
  Effect.map(eventsOf(harness), (events) => Arr.filter(events, Schema.is(Waived)))

/** The first `Intended` in the log. */
export const firstIntent = (harness: Harness) =>
  Effect.flatMap(intendedOf(harness), (intents) => Effect.fromOption(Arr.head(intents)))

/** Asserts that `exit` failed with an error `guard` accepts. */
export const failsWith = (exit: Exit.Exit<unknown, unknown>, guard: (error: unknown) => boolean) => {
  const error = Exit.isFailure(exit) ? Exit.findErrorOption(exit) : Option.none()
  expect(Option.exists(error, guard)).toBe(true)
}

/** Asserts that `effect` fails with `CommandRefused` naming exactly these reasons, appending nothing. */
export const refusedFor = (harness: Harness, effect: Effect.Effect<unknown, unknown>, reasons: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const before = yield* eventsOf(harness)
    const exit = yield* Effect.exit(effect)
    failsWith(exit, Schema.is(CommandRefused))
    const error = Exit.isFailure(exit) ? Option.getOrUndefined(Exit.findErrorOption(exit)) : undefined
    expect(error).toMatchObject({ reasons: reasons.map((tag) => ({ _tag: tag })) })
    expect(yield* eventsOf(harness)).toEqual(before)
  })
