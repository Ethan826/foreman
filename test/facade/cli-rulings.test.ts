// The CLI's `ruling add` and `overrule` (v0.2.0, dogfood-6b, owner
// rulings 2 and 8): parsing only. Both required texts are kept as given,
// line breaks included; one that is empty or only whitespace is a usage
// error, and so is a `--supersedes` that is not a ruling id.
import { describe, expect, it } from "@effect/vitest"
import { Option, Result } from "effect"
import { RulingId } from "../../src/domain/ids.ts"
import { OverruleFinding, parseArguments, RecordRuling, UsageError } from "../../src/facade/cli-arguments.ts"

const config = ["--config", "/etc/tarlatan.json"]

const parsed = (...words: ReadonlyArray<string>) =>
  Result.map(parseArguments([...config, ...words]), (invocation) => invocation.command)

/** The usage error's message for `words`, or none when they parse. */
const usageMessage = (...words: ReadonlyArray<string>) =>
  Result.match(parseArguments([...config, ...words]), {
    onFailure: (error: UsageError) => Option.some(error.message),
    onSuccess: () => Option.none(),
  })

describe("ruling add", () => {
  it("parses the text, with or without --supersedes, in either order", () => {
    expect(parsed("ruling", "add", "--text", "Keep it short.")).toEqual(
      Result.succeed(new RecordRuling({ text: "Keep it short.", supersedes: Option.none() })),
    )
    const superseding = new RecordRuling({ text: "Longer.", supersedes: Option.some(RulingId.make("R2")) })
    expect(parsed("ruling", "add", "--text", "Longer.", "--supersedes", "R2")).toEqual(Result.succeed(superseding))
    expect(parsed("ruling", "add", "--supersedes", "R2", "--text", "Longer.")).toEqual(Result.succeed(superseding))
  })

  it("keeps the text as given, line breaks and surrounding spaces included", () => {
    expect(parsed("ruling", "add", "--text", "  First.\nSecond.\n")).toEqual(
      Result.succeed(new RecordRuling({ text: "  First.\nSecond.\n", supersedes: Option.none() })),
    )
  })

  it("refuses an empty or blank text, and a missing one", () => {
    expect(usageMessage("ruling", "add", "--text", "")).toEqual(Option.some("--text must not be empty"))
    expect(usageMessage("ruling", "add", "--text", " \n\t")).toEqual(Option.some("--text must not be empty"))
    expect(usageMessage("ruling", "add")).toEqual(Option.some("--text is required"))
  })

  it("refuses a --supersedes that is not a ruling id, and an unknown flag", () => {
    expect(Option.isSome(usageMessage("ruling", "add", "--text", "T.", "--supersedes", "F1"))).toBe(true)
    expect(Option.isSome(usageMessage("ruling", "add", "--text", "T.", "--supersedes", "R0"))).toBe(true)
    expect(Option.isSome(usageMessage("ruling", "add", "--text", "T.", "--note", "x"))).toBe(true)
    expect(Option.isSome(usageMessage("ruling", "--text", "T."))).toBe(true)
  })
})

describe("overrule", () => {
  it("parses the finding id, then the note as given", () => {
    expect(parsed("overrule", "F2", "--note", "Out of scope.\nSee R1.")).toEqual(
      Result.succeed(new OverruleFinding({ findingId: "F2", note: "Out of scope.\nSee R1." })),
    )
  })

  it("refuses an empty or blank note, and a missing one", () => {
    expect(usageMessage("overrule", "F2", "--note", "")).toEqual(Option.some("--note must not be empty"))
    expect(usageMessage("overrule", "F2", "--note", "   ")).toEqual(Option.some("--note must not be empty"))
    expect(usageMessage("overrule", "F2")).toEqual(Option.some("--note is required"))
  })

  it("refuses a missing finding id", () => {
    expect(usageMessage("overrule", "--note", "Why.")).toEqual(Option.some("unknown argument: Why."))
    expect(usageMessage("overrule")).toEqual(Option.some("overrule needs a finding id"))
    expect(usageMessage("overrule", "", "--note", "Why.")).toEqual(Option.some("overrule needs a finding id"))
  })

  it("takes the first word as the finding id even when it looks like a flag", () => {
    expect(parsed("overrule", "--edge", "--note", "x")).toEqual(
      Result.succeed(new OverruleFinding({ findingId: "--edge", note: "x" })),
    )
    expect(parsed("overrule", "--note", "--note", "x")).toEqual(
      Result.succeed(new OverruleFinding({ findingId: "--note", note: "x" })),
    )
  })
})
