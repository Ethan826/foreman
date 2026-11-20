// The reviewer's findings block (plan "Outcomes and usable attempts",
// "Profiles, environment and briefs"): the last fenced block whose info
// string is `json` in the final message, decoded as a list of findings,
// and the owner's draft findings.md rendered from it.
import { describe, expect, it } from "@effect/vitest"
import { Option, Result, Schema } from "effect"
import {
  MalformedFindings,
  NoFindingsBlock,
} from "../../src/domain/findings.ts"
import {
  decodeFindingsBlock,
  renderFindingsDraft,
} from "../../src/format/findings.ts"

const fence = "```"

/** A message whose text is `lines` joined by newlines. */
const message = (...lines: Array<string>) => lines.join("\n")

/** A fenced block with info string `info` around `body`. */
const block = (info: string, body: string) =>
  message(`${fence}${info}`, body, fence)

const twoFindings = JSON.stringify([
  { id: "F1", severity: "blocking", file: "src/a.ts", summary: "Wrong sum." },
  { id: "F2", severity: "minor", summary: "Name is unclear." },
])

const decodedTwo = [
  {
    id: "F1",
    severity: "blocking",
    file: Option.some("src/a.ts"),
    summary: "Wrong sum.",
  },
  {
    id: "F2",
    severity: "minor",
    file: Option.none(),
    summary: "Name is unclear.",
  },
]

/** Whether `result` failed with a {@link MalformedFindings}. */
const failedMalformed = (result: ReturnType<typeof decodeFindingsBlock>) =>
  Option.map(Result.getFailure(result), Schema.is(MalformedFindings))

describe("decodeFindingsBlock", () => {
  it("decodes the findings in a json block", () => {
    const text = message("Review done.", block("json", twoFindings), "Bye.")
    expect(decodeFindingsBlock(text)).toEqual(Result.succeed(decodedTwo))
  })

  it("decodes an empty list as no findings", () => {
    expect(decodeFindingsBlock(block("json", "[]"))).toEqual(
      Result.succeed([]),
    )
  })

  it("fails with NoFindingsBlock when there is no block", () => {
    expect(decodeFindingsBlock("Looks good to me.")).toEqual(
      Result.fail(new NoFindingsBlock()),
    )
  })

  it("fails with MalformedFindings when the block is not JSON", () => {
    const result = decodeFindingsBlock(block("json", "[{ id: F1 }"))
    expect(failedMalformed(result)).toEqual(Option.some(true))
  })

  it("fails with MalformedFindings when an entry lacks a summary", () => {
    const body = JSON.stringify([{ id: "F1", severity: "minor" }])
    const result = decodeFindingsBlock(block("json", body))
    expect(failedMalformed(result)).toEqual(Option.some(true))
  })

  it("fails with MalformedFindings when the block is not an array", () => {
    const body = JSON.stringify({ id: "F1", severity: "minor", summary: "x" })
    const result = decodeFindingsBlock(block("json", body))
    expect(failedMalformed(result)).toEqual(Option.some(true))
  })

  it("fails with MalformedFindings when a field is empty", () => {
    const body = JSON.stringify([{ id: "", severity: "minor", summary: "x" }])
    const result = decodeFindingsBlock(block("json", body))
    expect(failedMalformed(result)).toEqual(Option.some(true))
  })

  it("uses the last json block when there are two", () => {
    const earlierFindings = JSON.stringify([
      { id: "F0", severity: "minor", summary: "Superseded." },
    ])
    const text = message(
      block("json", earlierFindings),
      "On reflection:",
      block("json", twoFindings),
    )
    expect(decodeFindingsBlock(text)).toEqual(Result.succeed(decodedTwo))
  })

  it("uses the last json block even when an earlier one is malformed", () => {
    const text = message(block("json", "not json"), block("json", "[]"))
    expect(decodeFindingsBlock(text)).toEqual(Result.succeed([]))
  })

  it("ignores a fence whose info string is not json", () => {
    const text = message(block("json", "[]"), block("ts", "const a = 1"))
    expect(decodeFindingsBlock(text)).toEqual(Result.succeed([]))
  })

  it("ignores a json fence inside a block of another language", () => {
    const text = message(
      block("json", "[]"),
      "````markdown",
      block("json", "not json"),
      "````",
    )
    expect(decodeFindingsBlock(text)).toEqual(Result.succeed([]))
  })

  it("does not close a block at a shorter fence", () => {
    const text = message(
      block("json", "[]"),
      "````markdown",
      fence,
      block("json", "not json"),
      "````",
    )
    expect(decodeFindingsBlock(text)).toEqual(Result.succeed([]))
  })

  it("does not close a backtick block at a tilde fence", () => {
    const text = message(`${fence}json`, "[]", "~~~", fence)
    const result = decodeFindingsBlock(text)
    expect(failedMalformed(result)).toEqual(Option.some(true))
  })

  it("does not take a json info string with more words as json", () => {
    const text = block("json findings", "[]")
    expect(decodeFindingsBlock(text)).toEqual(
      Result.fail(new NoFindingsBlock()),
    )
  })

  it("fails with NoFindingsBlock when only other fences are present", () => {
    expect(decodeFindingsBlock(block("ts", "[]"))).toEqual(
      Result.fail(new NoFindingsBlock()),
    )
  })

  it("reads a block whose lines end in CRLF", () => {
    const text = `${fence}json\r\n[]\r\n${fence}\r\n`
    expect(decodeFindingsBlock(text)).toEqual(Result.succeed([]))
  })

  it("reads an unclosed json block to the end of the message", () => {
    const text = message(`${fence}json`, "[]")
    expect(decodeFindingsBlock(text)).toEqual(Result.succeed([]))
  })
})

describe("renderFindingsDraft", () => {
  it("renders one section per finding, with its file when given", () => {
    const findings = Result.getOrElse(
      decodeFindingsBlock(block("json", twoFindings)),
      () => [],
    )
    expect(renderFindingsDraft(findings)).toBe(
      message(
        "# Findings",
        "",
        "## F1 (blocking)",
        "",
        "File: `src/a.ts`",
        "",
        "Wrong sum.",
        "",
        "## F2 (minor)",
        "",
        "Name is unclear.",
        "",
      ),
    )
  })

  it("says there are no findings for an empty list", () => {
    expect(renderFindingsDraft([])).toBe(
      message("# Findings", "", "No findings.", ""),
    )
  })
})
