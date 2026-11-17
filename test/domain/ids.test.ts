import { describe, expect, it } from "@effect/vitest"
import { Result, Schema } from "effect"
import { OpId, Revision, TrancheId, WaiverId } from "../../src/domain/ids.ts"

const sha1 = "556f9420a1b2c3d4e5f60718293a4b5c6d7e8f90"
const sha256 = "a".repeat(64)

const nameLike = [
  ["TrancheId", TrancheId],
  ["OpId", OpId],
  ["WaiverId", WaiverId],
] as const

// The cases every name-like identifier shares, named so the suite stays
// within the nesting limit (max-nested-callbacks).
const nameLikeCases = (schema: (typeof nameLike)[number][1]) => {
  const decode = Schema.decodeUnknownResult(schema)

  it("accepts a short slug", () => {
    expect(Result.isSuccess(decode("tranche-1.a_b"))).toBe(true)
  })

  it.each(["", " ", "-leading", "has space", "a/b", "x".repeat(65)])(
    "rejects %j",
    (input) => {
      expect(Result.isFailure(decode(input))).toBe(true)
    },
  )

  it("rejects non-strings", () => {
    expect(Result.isFailure(decode(7))).toBe(true)
  })
}

describe("identifiers", () => {

  nameLike.forEach(([name, schema]) => {
    describe(name, () => {
      nameLikeCases(schema)
    })
  })

  describe("Revision", () => {
    const decode = Schema.decodeUnknownResult(Revision)

    it("accepts a 40 digit and a 64 digit lowercase hex id", () => {
      expect(Result.isSuccess(decode(sha1))).toBe(true)
      expect(Result.isSuccess(decode(sha256))).toBe(true)
    })

    it.each(["", "HEAD", "abc123", sha1.toUpperCase(), `${sha1}0`, "g".repeat(40)])(
      "rejects %j",
      (input) => {
        expect(Result.isFailure(decode(input))).toBe(true)
      },
    )
  })
})
