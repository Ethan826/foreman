// The CLI's `rounds grant` and `session close --unconverged` (v0.2.0,
// dogfood-7, owner ruling 7): parsing only. The count is decimal digits
// with no sign and no leading zero, a safe integer of at least 1; the
// note is required, kept as given, and refused when empty or blank;
// `--attest` goes only with `--finished`.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Option, Result } from "effect"
import { CloseKinds } from "../../src/domain/session.ts"
import { CloseSession, GrantRoundsCommand, parseArguments, UsageError } from "../../src/facade/cli-arguments.ts"

const config = ["--config", "/etc/tarlatan.json"]

const parsed = (...words: ReadonlyArray<string>) =>
  Result.map(parseArguments([...config, ...words]), (invocation) => invocation.command)

/** The usage error's message for `words`, or none when they parse. */
const usageMessage = (...words: ReadonlyArray<string>) =>
  Result.match(parseArguments([...config, ...words]), {
    onFailure: (error: UsageError) => Option.some(error.message),
    onSuccess: () => Option.none(),
  })

/** One past `Number.MAX_SAFE_INTEGER`, as the owner would type it. */
const pastSafe = "9007199254740992"

describe("rounds grant", () => {
  it("parses the count, then the note as given", () => {
    expect(parsed("rounds", "grant", "2", "--note", "x")).toEqual(
      Result.succeed(new GrantRoundsCommand({ count: 2, note: "x" })),
    )
    expect(parsed("rounds", "grant", "10", "--note", " Slow.\nKeep going. ")).toEqual(
      Result.succeed(new GrantRoundsCommand({ count: 10, note: " Slow.\nKeep going. " })),
    )
  })

  it("accepts the largest safe integer", () => {
    expect(parsed("rounds", "grant", "9007199254740991", "--note", "x")).toEqual(
      Result.succeed(new GrantRoundsCommand({ count: Number.MAX_SAFE_INTEGER, note: "x" })),
    )
  })

  it.each(["0", "-1", "x", "02", "+2", "2.0", "", " 2", "1e3", pastSafe])("refuses the count %j", (count) => {
    expect(usageMessage("rounds", "grant", count, "--note", "x")).toEqual(
      Option.some(`rounds grant needs a whole number of at least 1, not ${count}`),
    )
  })

  it("refuses a missing count", () => {
    expect(usageMessage("rounds", "grant")).toEqual(Option.some("rounds grant needs a count"))
    expect(Option.isSome(usageMessage("rounds", "grant", "--note", "x"))).toBe(true)
  })

  it("refuses a missing, empty or blank note", () => {
    expect(usageMessage("rounds", "grant", "2")).toEqual(Option.some("--note is required"))
    expect(usageMessage("rounds", "grant", "2", "--note", "")).toEqual(Option.some("--note must not be empty"))
    expect(usageMessage("rounds", "grant", "2", "--note", " \n\t")).toEqual(Option.some("--note must not be empty"))
    expect(usageMessage("rounds", "grant", "2", "--note")).toEqual(Option.some("--note needs a value"))
  })

  it("refuses an unknown flag and a repeated note", () => {
    expect(Option.isSome(usageMessage("rounds", "grant", "2", "--note", "x", "--attest"))).toBe(true)
    expect(Option.isSome(usageMessage("rounds", "grant", "2", "--note", "x", "--note", "y"))).toBe(true)
    expect(Option.isSome(usageMessage("rounds", "2", "--note", "x"))).toBe(true)
  })
})

describe("session close --unconverged", () => {
  it("parses to the unconverged close, with or without a note", () => {
    expect(parsed("session", "close", "--unconverged")).toEqual(
      Result.succeed(new CloseSession({ how: CloseKinds.Unconverged, note: "" })),
    )
    expect(parsed("session", "close", "--unconverged", "--note", "still asks")).toEqual(
      Result.succeed(new CloseSession({ how: CloseKinds.Unconverged, note: "still asks" })),
    )
  })

  it("refuses --attest", () => {
    expect(usageMessage("session", "close", "--unconverged", "--attest")).toEqual(
      Option.some("--attest goes only with session close --finished"),
    )
  })

  it("refuses it beside any other kind", () => {
    Arr.forEach(["--abandoned", "--interrupted", "--finished"], (other) => {
      expect(usageMessage("session", "close", "--unconverged", other)).toEqual(
        Option.some("session close takes one of --abandoned, --interrupted, --unconverged and --finished"),
      )
    })
  })

  it("still maps --abandoned and --interrupted to their own kinds", () => {
    expect(parsed("session", "close", "--abandoned")).toEqual(
      Result.succeed(new CloseSession({ how: CloseKinds.Abandoned, note: "" })),
    )
    expect(parsed("session", "close", "--interrupted")).toEqual(
      Result.succeed(new CloseSession({ how: CloseKinds.Interrupted, note: "" })),
    )
  })
})
