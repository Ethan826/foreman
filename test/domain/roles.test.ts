import { describe, expect, it } from "@effect/vitest"
import { Result, Schema } from "effect"
import {
  Client,
  defaultRoleClients,
  Role,
  RoleClients,
  Step,
} from "../../src/domain/roles.ts"

describe("roles", () => {
  it("accepts the three roles and two clients only", () => {
    const role = Schema.decodeUnknownResult(Role)
    const client = Schema.decodeUnknownResult(Client)
    expect(Result.isSuccess(role("reviewer"))).toBe(true)
    expect(Result.isFailure(role("planner"))).toBe(true)
    expect(Result.isSuccess(client("codex"))).toBe(true)
    expect(Result.isFailure(client("gemini"))).toBe(true)
  })

  it("defaults: Claude implements and corrects, Codex reviews", () => {
    expect(defaultRoleClients).toEqual({
      implementer: "claude",
      reviewer: "codex",
      corrector: "claude",
    })
  })

  it("requires a client for every role", () => {
    const decode = Schema.decodeUnknownResult(RoleClients)
    expect(Result.isSuccess(decode(defaultRoleClients))).toBe(true)
    expect(Result.isFailure(decode({ implementer: "claude" }))).toBe(true)
    expect(
      Result.isFailure(decode({ ...defaultRoleClients, reviewer: "x" })),
    ).toBe(true)
  })

  it("allows the same client in two roles", () => {
    const decode = Schema.decodeUnknownResult(RoleClients)
    const same = { ...defaultRoleClients, reviewer: "claude" }
    expect(Result.isSuccess(decode(same))).toBe(true)
  })

  it("a step is a role and a non-negative round", () => {
    const decode = Schema.decodeUnknownResult(Step)
    expect(Result.isSuccess(decode({ role: "corrector", round: 1 }))).toBe(true)
    expect(Result.isFailure(decode({ role: "corrector", round: -1 }))).toBe(true)
    expect(Result.isFailure(decode({ role: "corrector", round: 1.5 }))).toBe(true)
    expect(Result.isFailure(decode({ role: "nobody", round: 0 }))).toBe(true)
  })
})
