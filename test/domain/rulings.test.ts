// The owner rulings' identifiers and events (v0.2.0, dogfood-6b, owner
// rulings 2 and 3): a ruling id is `R` and a positive decimal integer;
// `RulingAdded` decodes and encodes without `supersedes`, its text and
// an overrule's note must be non-empty, and a finding id is any
// non-empty string.
import { describe, expect, it } from "@effect/vitest"
import { Option, Result, Schema } from "effect"
import { FindingOverruled, ProjectEvent, RulingAdded } from "../../src/domain/events.ts"
import { OpId, RulingId } from "../../src/domain/ids.ts"
import { SessionId } from "../../src/domain/session.ts"

const decodeId = Schema.decodeUnknownResult(RulingId)
const decodeEvent = Schema.decodeUnknownResult(ProjectEvent)
const encodeEvent = Schema.encodeUnknownResult(ProjectEvent)

/** A `RulingAdded` row as the log holds it, with no `supersedes` key. */
const plainRow = { _tag: "RulingAdded", sessionId: "s-1", rulingId: "R1", text: "Keep it short." }

const plainRuling = new RulingAdded({
  sessionId: SessionId.make("s-1"),
  rulingId: RulingId.make("R1"),
  text: "Keep it short.",
  supersedes: Option.none(),
})

describe("RulingId", () => {
  it("decodes R followed by a positive decimal integer", () => {
    expect(decodeId("R1")).toEqual(Result.succeed("R1"))
    expect(decodeId("R12")).toEqual(Result.succeed("R12"))
    expect(decodeId("R1000")).toEqual(Result.succeed("R1000"))
  })

  it("refuses zero, a leading zero, a sign, a lowercase r, no digits and other text", () => {
    expect(Result.isFailure(decodeId("R0"))).toBe(true)
    expect(Result.isFailure(decodeId("R01"))).toBe(true)
    expect(Result.isFailure(decodeId("R-1"))).toBe(true)
    expect(Result.isFailure(decodeId("r1"))).toBe(true)
    expect(Result.isFailure(decodeId("R"))).toBe(true)
    expect(Result.isFailure(decodeId("R1 "))).toBe(true)
    expect(Result.isFailure(decodeId("F1"))).toBe(true)
  })
})

describe("RulingAdded", () => {
  it("decodes a row without supersedes as superseding nothing", () => {
    expect(decodeEvent(plainRow)).toEqual(Result.succeed(plainRuling))
  })

  it("encodes a ruling that supersedes nothing without the supersedes key", () => {
    expect(encodeEvent(plainRuling)).toEqual(Result.succeed(plainRow))
  })

  it("refuses an empty text", () => {
    expect(Result.isFailure(decodeEvent({ ...plainRow, text: "" }))).toBe(true)
  })

  it("keeps a text with line breaks as given", () => {
    const text = "First line.\n\nSecond line.\n"
    expect(decodeEvent({ ...plainRow, text })).toEqual(
      Result.succeed(
        new RulingAdded({
          sessionId: SessionId.make("s-1"),
          rulingId: RulingId.make("R1"),
          text,
          supersedes: Option.none(),
        }),
      ),
    )
  })
})

describe("FindingOverruled", () => {
  const row = {
    _tag: "FindingOverruled",
    sessionId: "s-1",
    reviewOpId: "op-2",
    findingId: "finding one",
    rulingId: "R2",
    note: "Out of scope.",
  }

  it("decodes any non-empty finding id", () => {
    expect(decodeEvent(row)).toEqual(
      Result.succeed(
        new FindingOverruled({
          sessionId: SessionId.make("s-1"),
          reviewOpId: OpId.make("op-2"),
          findingId: "finding one",
          rulingId: RulingId.make("R2"),
          note: "Out of scope.",
        }),
      ),
    )
  })

  it("refuses an empty note or finding id", () => {
    expect(Result.isFailure(decodeEvent({ ...row, note: "" }))).toBe(true)
    expect(Result.isFailure(decodeEvent({ ...row, findingId: "" }))).toBe(true)
  })
})
