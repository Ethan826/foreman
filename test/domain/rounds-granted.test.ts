// `RoundsGranted` (v0.2.0 design, "The correction limit"; dogfood-7,
// owner ruling 2): the event's schema itself refuses a count below 1, a
// count that is not a safe integer and an empty or blank note, whatever
// the CLI lets through; and the command `GrantRounds` refuses the same
// counts.
import { describe, expect, it } from "@effect/vitest"
import { Result, Schema } from "effect"
import { ProjectEvent, RoundsGranted } from "../../src/domain/events.ts"
import { GrantRounds, SessionId } from "../../src/domain/session.ts"

const decode = Schema.decodeUnknownResult(ProjectEvent)
const encode = Schema.encodeUnknownResult(ProjectEvent)

/** A `RoundsGranted` row with `count` and `note`. */
const row = (count: unknown, note: unknown) => ({ _tag: "RoundsGranted", sessionId: "s-1", count, note })

/** One past the largest safe integer. */
const pastSafe = Number.MAX_SAFE_INTEGER + 1

describe("RoundsGranted", () => {
  it("decodes and encodes a count of at least 1 with a note", () => {
    expect(Result.flatMap(decode(row(1, "Slow.")), encode)).toEqual(Result.succeed(row(1, "Slow.")))
    expect(Result.flatMap(decode(row(Number.MAX_SAFE_INTEGER, " x ")), encode)).toEqual(
      Result.succeed(row(Number.MAX_SAFE_INTEGER, " x ")),
    )
  })

  it.each([0, -1, 1.5, pastSafe, Number.NaN, Number.POSITIVE_INFINITY, "2"])("refuses the count %j", (count) => {
    expect(Result.isFailure(decode(row(count, "Slow.")))).toBe(true)
  })

  it.each(["", " ", "\n\t "])("refuses the blank note %j", (note) => {
    expect(Result.isFailure(decode(row(1, note)))).toBe(true)
  })

  it("refuses a missing note or session", () => {
    expect(Result.isFailure(decode({ _tag: "RoundsGranted", sessionId: "s-1", count: 1 }))).toBe(true)
    expect(Result.isFailure(decode({ _tag: "RoundsGranted", count: 1, note: "x" }))).toBe(true)
  })

  it("refuses to construct an event with a count of 0", () => {
    expect(() => new RoundsGranted({ sessionId: SessionId.make("s-1"), count: 0, note: "x" })).toThrow()
  })
})

describe("GrantRounds", () => {
  it("refuses a count of 0 and a count that is not an integer", () => {
    expect(() => new GrantRounds({ count: 0 })).toThrow()
    expect(() => new GrantRounds({ count: 1.5 })).toThrow()
    expect(new GrantRounds({ count: 2 }).count).toBe(2)
  })
})
