// The CLI's argument parsing (plan "Slice A1", facade): A1's commands
// only, each mapped to one Program call. Parsing only; nothing runs.
import { describe, expect, it } from "@effect/vitest"
import { Result } from "effect"
import { GrantId, OpId, TrancheId } from "../../src/domain/ids.ts"
import { CloseKinds } from "../../src/domain/session.ts"
import {
  CloseSession,
  CreateWorktree,
  EndStep,
  OpenSession,
  parseArguments,
  RunImplement,
  ShowStatus,
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

  it("refuses A2's commands and anything unknown", () => {
    refused(...config, "review", "--attest")
    refused(...config, "correct")
    refused(...config, "reject")
    refused(...config, "session", "close", "--finished", "--attest")
    refused(...config, "launch")
    refused(...config)
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
