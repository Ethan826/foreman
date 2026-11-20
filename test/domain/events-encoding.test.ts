// Golden encoding of the project log: one encoded row of every
// ProjectEvent member, written from the schema before events.ts was split
// (plan "Slice A1", first commit). A schema change that alters what a log
// row looks like, or a member left out of the union, fails here.
import { describe, expect, it } from "@effect/vitest"
import { Result, Schema } from "effect"
import { ProjectEvent } from "../../src/domain/events.ts"

/** The fixture's text, read as raw bytes so the comparison is exact. */
const fixtureText =
  Object.values(
    import.meta.glob<string>("../fixtures/events/encoded-events.json", {
      query: "?raw",
      import: "default",
      eager: true,
    }),
  )[0] ?? ""
const rowsResult = Schema.decodeUnknownResult(
  Schema.fromJsonString(Schema.Array(Schema.Unknown)),
)(fixtureText)
const rows = Result.getOrElse(rowsResult, () => [])

const decode = Schema.decodeUnknownResult(ProjectEvent)
const encode = Schema.encodeUnknownResult(ProjectEvent)

/** The row decoded as a ProjectEvent and encoded again. */
const reencode = (row: unknown) => Result.flatMap(decode(row), encode)

/** The row re-encoded, or null when it does not round-trip. */
const reencodedOrNull = (row: unknown) =>
  Result.getOrElse(reencode(row), () => null)

/** The decoded rows that are instances of `member`. */
const rowsOf = (member: (typeof ProjectEvent.members)[number]) =>
  rows.filter((row) => Result.match(decode(row), {
    onFailure: () => false,
    onSuccess: Schema.is(member),
  }))

describe("encoded project events", () => {
  it("reads the fixture as an array of rows", () => {
    expect(Result.isSuccess(rowsResult)).toBe(true)
  })

  it.each(rows)("decodes and re-encodes %j unchanged", (row) => {
    expect(reencode(row)).toEqual(Result.succeed(row))
  })

  it("re-encodes the whole fixture byte for byte", () => {
    const reencoded = rows.map(reencodedOrNull)
    expect(`${JSON.stringify(reencoded, null, 2)}\n`).toBe(fixtureText)
  })

  it("holds exactly one row of every ProjectEvent member", () => {
    expect(rows).toHaveLength(ProjectEvent.members.length)
    ProjectEvent.members.forEach((member) => {
      expect(rowsOf(member)).toHaveLength(1)
    })
  })
})
