import { describe, expect, it } from "@effect/vitest"
import { Result, Schema } from "effect"
import {
  CommitOutcome,
  StepOutcome,
  TrancheEnd,
} from "../../src/domain/outcomes.ts"

const accepts = (
  schema: Schema.ConstraintDecoder<unknown>,
  input: unknown,
) => Result.isSuccess(Schema.decodeUnknownResult(schema)(input))

describe("StepOutcome", () => {
  it.each([
    { _tag: "Success" },
    { _tag: "ChangesRequested" },
    { _tag: "RateLimited", windows: ["fiveHour"] },
    { _tag: "RateLimited", windows: [] },
    { _tag: "AuthFailed" },
    { _tag: "PermissionDenied" },
    { _tag: "MaxTurns" },
    { _tag: "Crashed", signal: "SIGKILL" },
    { _tag: "Unclassified" },
  ])("accepts %j", (input) => {
    expect(accepts(StepOutcome, input)).toBe(true)
  })

  it.each([
    { _tag: "Unknown" },
    { _tag: "Crashed", signal: "" },
    { _tag: "Crashed" },
    { _tag: "RateLimited", windows: ["monthly"] },
    { _tag: "RateLimited" },
    {},
  ])("rejects %j", (input) => {
    expect(accepts(StepOutcome, input)).toBe(false)
  })
})

describe("CommitOutcome", () => {
  const rev = "a".repeat(40)

  it("accepts the four commit outcomes", () => {
    expect(accepts(CommitOutcome, { _tag: "NothingToCommit" })).toBe(true)
    expect(
      accepts(CommitOutcome, {
        _tag: "Committed",
        revision: rev,
        changedPaths: ["a.ts"],
      }),
    ).toBe(true)
    expect(
      accepts(CommitOutcome, { _tag: "CommitRefused", reason: "headMoved" }),
    ).toBe(true)
    expect(
      accepts(CommitOutcome, { _tag: "CommitFailed", error: "boom" }),
    ).toBe(true)
  })

  it("rejects a bad revision, an unknown reason and an empty error", () => {
    expect(
      accepts(CommitOutcome, { _tag: "Committed", revision: "HEAD", changedPaths: [] }),
    ).toBe(false)
    expect(
      accepts(CommitOutcome, { _tag: "CommitRefused", reason: "tired" }),
    ).toBe(false)
    expect(accepts(CommitOutcome, { _tag: "CommitFailed", error: "" })).toBe(
      false,
    )
  })
})

describe("TrancheEnd", () => {
  it("has passed, abandoned and notConverged", () => {
    expect(accepts(TrancheEnd, { _tag: "Passed" })).toBe(true)
    expect(accepts(TrancheEnd, { _tag: "Abandoned" })).toBe(true)
    expect(accepts(TrancheEnd, { _tag: "NotConverged" })).toBe(true)
    expect(accepts(TrancheEnd, { _tag: "Extended" })).toBe(false)
  })
})
