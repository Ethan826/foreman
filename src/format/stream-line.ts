// One line of a client's JSON event stream, as classification reads it
// (review item B13). Each vendor's stream carries many event types that
// say nothing about how the run ended, such as Claude's `assistant` and
// `user` messages or Codex's `item.*` events; they are passed over. The
// event types that bear the outcome must decode, and a line that is not
// JSON, or not an object with a string `type`, is malformed. A malformed
// line is reported, never skipped, so that classification can make the
// attempt close-only rather than read a success around it.
import { Array as Arr, Option, Result, Schema } from "effect"

/**
 * A stream line read: an outcome-bearing event (`Success(Some)`), an
 * event of a type that bears no outcome (`Success(None)`), or why the
 * line is malformed (`Failure`).
 */
export type StreamLine<A> = Result.Result<Option.Option<A>, string>

/** The one field every event object of either stream has. */
const EventObject = Schema.Struct({ type: Schema.String })

const decodeJson = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Unknown))
const decodeEventObject = Schema.decodeUnknownResult(EventObject)

/**
 * Reads one line of a stream whose events of the types in `outcomeTypes`
 * decode with `decode`; see {@link StreamLine}. Each failure's reason
 * names the line.
 */
export const streamLineWith =
  <A>(
    outcomeTypes: ReadonlyArray<string>,
    decode: (value: unknown) => Result.Result<A, { readonly message: string }>,
  ) =>
  (line: string): StreamLine<A> =>
    Result.mapError(
      Result.gen(function* () {
        const value = yield* Result.mapError(decodeJson(line), messageOf)
        const event = yield* Result.mapError(decodeEventObject(value), messageOf)
        if (!Arr.contains(outcomeTypes, event.type)) return Option.none<A>()
        return Option.some(yield* Result.mapError(decode(value), messageOf))
      }),
      (reason) => `${reason}: ${line}`,
    )

/** A decoding issue's message. */
const messageOf = (issue: { readonly message: string }): string => issue.message
