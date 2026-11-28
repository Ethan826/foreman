// `rounds grant` and `session close --unconverged` through the CLI's
// `main` over the production composition (v0.2.0, dogfood-7, owner
// ruling 7): `rounds grant` prints the event it appended as JSON, a bad
// count or a blank note is a usage error (exit 2) that appends nothing,
// `status` prints the session's grants and its correction limit (none
// with no session open), and `session close --unconverged` reaches the
// close rules over the owner's exits, which refuse it with no review at
// the limit.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Effect, Formatter, Option, Schema } from "effect"
import { RoundsGranted } from "../../src/domain/events.ts"
import { GrantedRounds } from "../../src/domain/rulings.ts"
import { cli, type CliRun, endToEndMillis, succeeded, withLayout } from "./production-harness.ts"

/** The indent of the JSON the CLI prints, in spaces. */
const jsonIndent = 2

/** What a run printed on stdout, decoded by `schema` from its JSON. */
const printedAs = <A, I>(schema: Schema.Codec<A, I>, run: CliRun) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(Arr.join(run.out, "\n"))

/** `value` encoded by `schema` and laid out as the CLI prints it, read back as plain JSON. */
const asPrinted = <A, I>(schema: Schema.Codec<A, I>, value: A) =>
  Effect.flatMap(Schema.encodeEffect(schema)(value), (encoded) =>
    Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(Formatter.formatJson(encoded, { space: jsonIndent })),
  )

/** The part of the printed status these tests read. */
const Shown = Schema.Struct({ report: Schema.Struct({ state: Schema.Unknown, correctionLimit: Schema.Unknown }) })

/** The status a run printed, as far as {@link Shown} reads it. */
const shownBy = (run: CliRun) => Schema.decodeUnknownEffect(Schema.fromJsonString(Shown))(Arr.join(run.out, "\n"))

const note = "The review converges slowly."

const grantedAndShown = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* succeeded(layout, ["worktree", "create"])
      const before = yield* shownBy(yield* succeeded(layout, ["status"]))
      expect(before.report.correctionLimit).toEqual(yield* asPrinted(Schema.Option(Schema.Int), Option.none()))
      yield* succeeded(layout, ["session", "open", "--tranche", "t-1", "--task", layout.taskFile])
      const granted = yield* printedAs(RoundsGranted, yield* succeeded(layout, ["rounds", "grant", "2", "--note", note]))
      expect([granted.count, granted.note]).toEqual([2, note])
      const zero = yield* cli(layout, ["rounds", "grant", "0", "--note", note])
      expect([zero.status, zero.out]).toEqual([2, []])
      const blank = yield* cli(layout, ["rounds", "grant", "1", "--note", " "])
      expect([blank.status, blank.out]).toEqual([2, []])
      expect(Arr.join(blank.err, "\n")).toContain("--note must not be empty")
      const after = yield* shownBy(yield* succeeded(layout, ["status"]))
      expect(after.report.correctionLimit).toEqual(yield* asPrinted(Schema.Option(Schema.Int), Option.some(4)))
      const roundsGranted = yield* asPrinted(Schema.Array(GrantedRounds), [{ count: 2, note }])
      expect(after.report.state).toMatchObject({ _tag: "OpenNoAttempt", session: { roundsGranted } })
      const close = yield* cli(layout, ["session", "close", "--unconverged"])
      expect(close.status).toBe(1)
      expect(Arr.join(close.err, "\n")).toContain("WrongState")
      expect(Arr.join(close.err, "\n")).toContain("CorrectionsRemain")
    }),
  )

describe("rounds grant and close --unconverged through the CLI", () => {
  it.effect("grant prints its event, refuses a bad count and a blank note, and shows in status", grantedAndShown, endToEndMillis)
})
