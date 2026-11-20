// The CLI's argument parsing (plan "Slice A1" and "Slice A2", facade):
// the commands of both slices, each mapped to one Program call. Parsing
// only; nothing runs, and the facade decides nothing: `--attest` is read
// as given and Program refuses a handoff without it.
import { describe, expect, it } from "@effect/vitest"
import { Result } from "effect"
import { GrantId, OpId, TrancheId } from "../../src/domain/ids.ts"
import { CloseKinds } from "../../src/domain/session.ts"
import {
  CloseSession,
  CreateWorktree,
  EndStep,
  FinishSession,
  OpenSession,
  parseArguments,
  RejectHandoff,
  RunCorrect,
  RunImplement,
  RunReview,
  ShowStatus,
  usage,
  UsageError,
} from "../../src/facade/cli-arguments.ts"

const config = ["--config", "/etc/foreman.json"]

const parsed = (...words: ReadonlyArray<string>) => Result.getOrUndefined(parseArguments([...config, ...words]))

const refused = (...argv: ReadonlyArray<string>) => {
  const result = parseArguments(argv)
  expect(Result.isFailure(result)).toBe(true)
  expect(Result.isFailure(result) && result.failure).toBeInstanceOf(UsageError)
}

describe("parseArguments", () => {
  it("parses worktree create", () => {
    expect(parsed("worktree", "create")).toEqual({ configPath: "/etc/foreman.json", command: new CreateWorktree() })
  })

  it("parses session open with its tranche and task, in either order", () => {
    const expected = new OpenSession({ tranche: TrancheId.make("t-1"), taskFile: "/tasks/a.md" })
    expect(parsed("session", "open", "--tranche", "t-1", "--task", "/tasks/a.md")?.command).toEqual(expected)
    expect(parsed("session", "open", "--task", "/tasks/a.md", "--tranche", "t-1")?.command).toEqual(expected)
  })

  it("parses implement with and without --waive", () => {
    expect(parsed("implement")?.command).toEqual(new RunImplement({ waive: false }))
    expect(parsed("implement", "--waive")?.command).toEqual(new RunImplement({ waive: true }))
  })

  it("parses status", () => {
    expect(parsed("status")?.command).toEqual(new ShowStatus())
  })

  it("parses step-ended with its grant", () => {
    expect(parsed("step-ended", "op-1", "--grant", "g-1")?.command).toEqual(new EndStep({ opId: OpId.make("op-1"), grantId: GrantId.make("g-1") }))
  })

  it("parses session close --abandoned and --interrupted, with or without a note", () => {
    expect(parsed("session", "close", "--abandoned")?.command).toEqual(
      new CloseSession({ how: CloseKinds.Abandoned, note: "" }),
    )
    expect(parsed("session", "close", "--interrupted", "--note", "ran long")?.command).toEqual(
      new CloseSession({ how: CloseKinds.Interrupted, note: "ran long" }),
    )
  })

  it("requires --config <path> first", () => {
    refused("status")
    refused("--config")
    refused("status", "--config", "/etc/foreman.json")
  })

  it("parses review with or without --waive and --attest", () => {
    expect(parsed("review", "--attest")?.command).toEqual(new RunReview({ waive: false, attest: true }))
    expect(parsed("review", "--waive", "--attest")?.command).toEqual(new RunReview({ waive: true, attest: true }))
    expect(parsed("review")?.command).toEqual(new RunReview({ waive: false, attest: false }))
  })

  it("parses correct with its findings file, --waive and --attest", () => {
    expect(parsed("correct", "--findings", "/f.md", "--attest")?.command).toEqual(
      new RunCorrect({ findingsFile: "/f.md", waive: false, attest: true }),
    )
    expect(parsed("correct", "--waive", "--attest", "--findings", "/f.md")?.command).toEqual(
      new RunCorrect({ findingsFile: "/f.md", waive: true, attest: true }),
    )
    expect(parsed("correct", "--findings", "/f.md")?.command).toEqual(
      new RunCorrect({ findingsFile: "/f.md", waive: false, attest: false }),
    )
  })

  it("parses reject with or without a note", () => {
    expect(parsed("reject")?.command).toEqual(new RejectHandoff({ note: "" }))
    expect(parsed("reject", "--note", "wrong file")?.command).toEqual(new RejectHandoff({ note: "wrong file" }))
  })

  it("parses session close --finished with --attest and a note", () => {
    expect(parsed("session", "close", "--finished", "--attest")?.command).toEqual(
      new FinishSession({ note: "", attest: true }),
    )
    expect(parsed("session", "close", "--attest", "--finished", "--note", "done")?.command).toEqual(
      new FinishSession({ note: "done", attest: true }),
    )
    expect(parsed("session", "close", "--finished")?.command).toEqual(new FinishSession({ note: "", attest: false }))
  })

  it("refuses anything unknown", () => {
    refused(...config, "launch")
    refused(...config)
  })

  it("refuses correct without its findings file and reject or review with another's flags", () => {
    refused(...config, "correct", "--attest")
    refused(...config, "correct", "--findings")
    refused(...config, "reject", "--attest")
    refused(...config, "review", "--findings", "/f.md")
    refused(...config, "review", "--attest", "--attest")
  })

  it("refuses --attest on an abandoned or interrupted close, and more than one kind", () => {
    refused(...config, "session", "close", "--abandoned", "--attest")
    refused(...config, "session", "close", "--interrupted", "--attest")
    refused(...config, "session", "close", "--finished", "--abandoned")
    refused(...config, "session", "close", "--attest")
  })

  it("refuses a missing, repeated, unknown or valueless flag", () => {
    refused(...config, "session", "open", "--tranche", "t-1")
    refused(...config, "session", "open", "--tranche", "t-1", "--tranche", "t-2", "--task", "/a")
    refused(...config, "session", "open", "--tranche", "t-1", "--task", "/a", "--base", "x")
    refused(...config, "session", "open", "--tranche", "t-1", "--task")
    refused(...config, "implement", "--waive", "--waive")
    refused(...config, "step-ended", "op-1")
    refused(...config, "step-ended", "--grant", "g-1")
  })

  it("refuses close with neither or both kinds", () => {
    refused(...config, "session", "close")
    refused(...config, "session", "close", "--abandoned", "--interrupted")
  })

  it("refuses an identifier that is not a slug and a trailing argument", () => {
    refused(...config, "session", "open", "--tranche", "t 1", "--task", "/a")
    refused(...config, "step-ended", "op/1", "--grant", "g-1")
    refused(...config, "status", "extra")
    refused(...config, "worktree", "create", "now")
  })
})

describe("usage", () => {
  it("states the owner's rule for a launch that does not return after its client exits", () => {
    expect(usage).toMatch(/interrupt foreman/)
    expect(usage).toMatch(/status, step-ended <opId> --grant <grantId>, then session close --interrupted/)
    expect(usage).toMatch(/foreman never signals/)
  })
})
