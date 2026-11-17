// Waivers (design "Waivers", claim C7). `waive <provider>` is accepted only
// while a quota hold for that provider exists and no waiver is armed. The
// waiver is armed from its `Waived` record until the next launch attempt:
// an `Intended` naming it uses it, and an attempt that does not launch a
// step of the waived provider expires it (`WaiverExpired`). A restart does
// not expire it. A waived launch skips pacing but still takes its grant at
// its estimate.
import { Array as Arr, Option, Record, Schema } from "effect"
import { type Client, Clients } from "../domain/clients.ts"
import { Intended, type ProjectEvent, Waived, WaiverExpired } from "../domain/events.ts"
import { type Hold, Quota } from "../domain/holds.ts"
import type { WaiverId } from "../domain/ids.ts"

/** Whether `event` ends waiver `waiverId`: uses it or expires it. */
const ends = (waiverId: WaiverId) => (event: ProjectEvent): boolean =>
  (Schema.is(Intended)(event) && Option.contains(event.waiverId, waiverId)) ||
  (Schema.is(WaiverExpired)(event) && event.waiverId === waiverId)

/**
 * The waiver armed for `provider`, if any: the latest `Waived` of that
 * provider with no later `Intended` naming it and no later
 * `WaiverExpired` of it.
 */
export const armedWaiver = (
  events: ReadonlyArray<ProjectEvent>,
  provider: Client,
): Option.Option<WaiverId> =>
  Option.flatMap(
    Arr.findLastIndex(events, (event) => Schema.is(Waived)(event) && event.provider === provider),
    (index) =>
      Option.flatMap(Arr.get(events, index), (waived) =>
        Schema.is(Waived)(waived) && !Arr.some(Arr.drop(events, index + 1), ends(waived.waiverId))
          ? Option.some(waived.waiverId)
          : Option.none(),
      ),
  )

/**
 * Whether `waive <provider>` is accepted: a quota hold of that provider
 * is in place and no waiver is armed for any provider.
 */
export const waiveAccepted = (
  holds: ReadonlyArray<Hold>,
  events: ReadonlyArray<ProjectEvent>,
  provider: Client,
): boolean =>
  Arr.some(holds, (hold) => Schema.is(Quota)(hold) && hold.provider === provider) &&
  Arr.every(Record.values(Clients), (client) => Option.isNone(armedWaiver(events, client)))
