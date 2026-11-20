// Attempt classification (plan "Outcomes and usable attempts", AC6;
// design E6): from the leader's exit and the decoded client events only,
// and a reviewer's verdict from its decoded findings block.
import { describe, expect, it } from "@effect/vitest"
import { Option, Result } from "effect"
import { MalformedFindings, NoFindingsBlock } from "../../src/domain/findings.ts"
import {
  AuthFailed,
  ChangesRequested,
  Crashed,
  MaxTurns,
  PermissionDenied,
  RateLimited,
  Success,
  Unclassified,
} from "../../src/domain/outcomes.ts"
import { type Role, Roles } from "../../src/domain/roles.ts"
import type { ClaudeResult } from "../../src/format/claude.ts"
import {
  ClaudeDecoded,
  classifyAttempt,
  CodexDecoded,
  type DecodedAttempt,
  usable,
} from "../../src/features/step-outcome.ts"

const exitedWith = (code: number) => ({ code: Option.some(code), signal: Option.none<string>() })
const killedBy = (signal: string) => ({ code: Option.none<number>(), signal: Option.some(signal) })

const claudeResult = (fields: { subtype?: string; is_error?: boolean }) =>
  new ClaudeDecoded({ result: Option.some({ type: "result" as const, ...fields }), malformed: [] })
const claudeSuccess = claudeResult({ subtype: "success", is_error: false })
const codex = (turnCompleted: boolean, failureReported: boolean, malformed: ReadonlyArray<string> = []) =>
  new CodexDecoded({ turnCompleted, failureReported, malformed })
const codexClean = codex(true, false)

const finding = { id: "F1", severity: "high", file: Option.none(), summary: "Broken." }
const attempt = (
  client: DecodedAttempt["client"],
  findings: DecodedAttempt["findings"] = Option.none(),
): DecodedAttempt => ({ client, findings })
const review = (findings: DecodedAttempt["findings"]) => attempt(codexClean, findings)

describe("classifyAttempt: implementer and corrector", () => {
  it.each([Roles.Implementer, Roles.Corrector])("%s: a clean Claude result and exit 0 is Success", (role: Role) => {
    expect(classifyAttempt(role, exitedWith(0), attempt(claudeSuccess))).toEqual(new Success())
  })

  it("a signal is Crashed with that signal, whatever the events say", () => {
    expect(classifyAttempt(Roles.Implementer, killedBy("SIGTERM"), attempt(claudeSuccess))).toEqual(
      new Crashed({ signal: "SIGTERM" }),
    )
  })

  it("an empty signal name is Unclassified, not Crashed", () => {
    expect(classifyAttempt(Roles.Implementer, killedBy(""), attempt(claudeSuccess))).toEqual(new Unclassified())
  })

  it("the max-turns result subtype is MaxTurns, whatever the exit code", () => {
    const decoded = attempt(claudeResult({ subtype: "error_max_turns", is_error: true }))
    expect(classifyAttempt(Roles.Implementer, exitedWith(1), decoded)).toEqual(new MaxTurns())
  })

  it("no result event is Unclassified, even with exit 0", () => {
    const decoded = attempt(new ClaudeDecoded({ result: Option.none(), malformed: [] }))
    expect(classifyAttempt(Roles.Implementer, exitedWith(0), decoded)).toEqual(new Unclassified())
  })

  it("an error result is Unclassified", () => {
    const decoded = attempt(claudeResult({ subtype: "success", is_error: true }))
    expect(classifyAttempt(Roles.Implementer, exitedWith(0), decoded)).toEqual(new Unclassified())
  })

  it("a result without is_error is Unclassified", () => {
    const decoded = attempt(claudeResult({ subtype: "success" }))
    expect(classifyAttempt(Roles.Implementer, exitedWith(0), decoded)).toEqual(new Unclassified())
  })

  it("another subtype is Unclassified", () => {
    const decoded = attempt(claudeResult({ subtype: "error_during_execution", is_error: false }))
    expect(classifyAttempt(Roles.Implementer, exitedWith(0), decoded)).toEqual(new Unclassified())
  })

  it("a clean result with a nonzero exit is Unclassified", () => {
    expect(classifyAttempt(Roles.Implementer, exitedWith(2), attempt(claudeSuccess))).toEqual(new Unclassified())
  })

  it("no exit code and no signal is Unclassified", () => {
    const exit = { code: Option.none<number>(), signal: Option.none<string>() }
    expect(classifyAttempt(Roles.Implementer, exit, attempt(claudeSuccess))).toEqual(new Unclassified())
  })

  it("a clean Codex run with exit 0 is Success for an implementer", () => {
    expect(classifyAttempt(Roles.Implementer, exitedWith(0), attempt(codexClean))).toEqual(new Success())
  })
})

describe("classifyAttempt: reviewer", () => {
  it("an empty findings list is Success", () => {
    expect(classifyAttempt(Roles.Reviewer, exitedWith(0), review(Option.some(Result.succeed([]))))).toEqual(
      new Success(),
    )
  })

  it("a non-empty findings list is ChangesRequested", () => {
    expect(
      classifyAttempt(Roles.Reviewer, exitedWith(0), review(Option.some(Result.succeed([finding])))),
    ).toEqual(new ChangesRequested())
  })

  it("an absent findings block is Unclassified", () => {
    const findings = Option.some(Result.fail(new NoFindingsBlock()))
    expect(classifyAttempt(Roles.Reviewer, exitedWith(0), review(findings))).toEqual(new Unclassified())
  })

  it("a malformed findings block is Unclassified", () => {
    const findings = Option.some(Result.fail(new MalformedFindings({ reason: "not JSON" })))
    expect(classifyAttempt(Roles.Reviewer, exitedWith(0), review(findings))).toEqual(new Unclassified())
  })

  it("no final message to decode is Unclassified", () => {
    expect(classifyAttempt(Roles.Reviewer, exitedWith(0), review(Option.none()))).toEqual(new Unclassified())
  })

  it("a reported failure after a completed turn is Unclassified", () => {
    const decoded = attempt(codex(true, true), Option.some(Result.succeed([])))
    expect(classifyAttempt(Roles.Reviewer, exitedWith(0), decoded)).toEqual(new Unclassified())
  })

  it("a run with no completed turn is Unclassified", () => {
    const decoded = attempt(codex(false, false), Option.some(Result.succeed([])))
    expect(classifyAttempt(Roles.Reviewer, exitedWith(0), decoded)).toEqual(new Unclassified())
  })

  it("a nonzero exit is Unclassified even with clean findings", () => {
    expect(classifyAttempt(Roles.Reviewer, exitedWith(1), review(Option.some(Result.succeed([]))))).toEqual(
      new Unclassified(),
    )
  })

  it("a Claude reviewer's verdict also comes from its findings", () => {
    const decoded = attempt(claudeSuccess, Option.some(Result.succeed([finding])))
    expect(classifyAttempt(Roles.Reviewer, exitedWith(0), decoded)).toEqual(new ChangesRequested())
  })
})

describe("malformed stream lines", () => {
  it("make a clean Claude success Unclassified", () => {
    const client = new ClaudeDecoded({ result: claudeSuccess.result, malformed: ["not JSON: {"] })
    expect(classifyAttempt(Roles.Implementer, exitedWith(0), attempt(client))).toEqual(new Unclassified())
  })

  it("make a clean Codex review Unclassified", () => {
    const decoded = attempt(codex(true, false, ["malformed error event"]), Option.some(Result.succeed([])))
    expect(classifyAttempt(Roles.Reviewer, exitedWith(0), decoded)).toEqual(new Unclassified())
  })

  it("leave a signal Crashed", () => {
    const client = new ClaudeDecoded({ result: claudeSuccess.result, malformed: ["not JSON: {"] })
    expect(classifyAttempt(Roles.Implementer, killedBy("SIGKILL"), attempt(client))).toEqual(
      new Crashed({ signal: "SIGKILL" }),
    )
  })
})

describe("decoded input shapes", () => {
  it("accept the Format decoder's Claude result as it is", () => {
    const fromClaude = (result: ClaudeResult) => new ClaudeDecoded({ result: Option.some(result), malformed: [] })
    expect(fromClaude({ type: "result" }).result).toEqual(Option.some({ type: "result" }))
  })
})

describe("usable", () => {
  const unusable = [
    new RateLimited({ windows: [] }),
    new AuthFailed(),
    new PermissionDenied(),
    new MaxTurns(),
    new Crashed({ signal: "SIGKILL" }),
    new Unclassified(),
  ]

  it.each([Roles.Implementer, Roles.Corrector])("%s: only Success is usable", (role: Role) => {
    expect(usable(role, new Success())).toBe(true)
    expect(usable(role, new ChangesRequested())).toBe(false)
    unusable.forEach((outcome) => {
      expect(usable(role, outcome)).toBe(false)
    })
  })

  it("reviewer: Success and ChangesRequested are usable", () => {
    expect(usable(Roles.Reviewer, new Success())).toBe(true)
    expect(usable(Roles.Reviewer, new ChangesRequested())).toBe(true)
    unusable.forEach((outcome) => {
      expect(usable(Roles.Reviewer, outcome)).toBe(false)
    })
  })
})
