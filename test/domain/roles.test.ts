import { describe, expect, it } from "@effect/vitest"
import { Result, Schema } from "effect"
import { Client, Clients } from "../../src/domain/clients.ts"
import {
  defaultRoleClients,
  Role,
  RoleClients,
  Roles,
  Step,
} from "../../src/domain/roles.ts"

describe("roles", () => {
  it("accepts the three roles and two clients only", () => {
    const role = Schema.decodeUnknownResult(Role)
    const client = Schema.decodeUnknownResult(Client)
    expect(Result.isSuccess(role(Roles.Reviewer))).toBe(true)
    expect(Result.isFailure(role("planner"))).toBe(true)
    expect(Result.isSuccess(client(Clients.Codex))).toBe(true)
    expect(Result.isFailure(client("gemini"))).toBe(true)
  })

  it("defaults: Claude implements and corrects, Codex reviews", () => {
    expect(defaultRoleClients).toEqual({
      [Roles.Implementer]: Clients.Claude,
      [Roles.Reviewer]: Clients.Codex,
      [Roles.Corrector]: Clients.Claude,
    })
  })

  it("requires a client for every role", () => {
    const decode = Schema.decodeUnknownResult(RoleClients)
    expect(Result.isSuccess(decode(defaultRoleClients))).toBe(true)
    expect(Result.isFailure(decode({ [Roles.Implementer]: Clients.Claude }))).toBe(true)
    expect(
      Result.isFailure(decode({ ...defaultRoleClients, reviewer: "x" })),
    ).toBe(true)
  })

  it("allows the same client in two roles", () => {
    const decode = Schema.decodeUnknownResult(RoleClients)
    const same = { ...defaultRoleClients, [Roles.Reviewer]: Clients.Claude }
    expect(Result.isSuccess(decode(same))).toBe(true)
  })

  it("a step is a role and a non-negative round", () => {
    const decode = Schema.decodeUnknownResult(Step)
    expect(Result.isSuccess(decode({ role: Roles.Corrector, round: 1 }))).toBe(true)
    expect(Result.isFailure(decode({ role: Roles.Corrector, round: -1 }))).toBe(true)
    expect(Result.isFailure(decode({ role: Roles.Corrector, round: 1.5 }))).toBe(true)
    expect(Result.isFailure(decode({ role: "nobody", round: 0 }))).toBe(true)
  })
})
