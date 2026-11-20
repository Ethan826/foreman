// The configuration file decoder (plan "Slice A1", Format
// `foreman-config.ts`; decisions P4 and P5): strict JSON, every path
// absolute, both client pins present, unknown keys refused, and the
// per-role grant estimate defaulting to the policy's initialEstimate.
import { describe, expect, it } from "@effect/vitest"
import { Result } from "effect"
import { Clients } from "../../src/domain/clients.ts"
import { defaultPolicy } from "../../src/domain/policy.ts"
import { Roles } from "../../src/domain/roles.ts"
import { ConfigUndecodable, decodeForemanConfig } from "../../src/format/foreman-config.ts"

const pins = { [Clients.Claude]: "2.1.328 (Claude Code)", [Clients.Codex]: "codex-cli 0.170.0" }

const file = (overrides: Record<string, unknown> = {}) => ({
  projectId: "foreman",
  stateDir: "/state",
  ownerCheckout: "/owner",
  supervisor: { path: "/state/worktree", name: "assisted" },
  attributeAllowance: { rootLines: ["* text=auto"] },
  pins,
  claudeSettings: "/state/claude-settings.json",
  ...overrides,
})

const decoded = (value: unknown) => decodeForemanConfig(JSON.stringify(value))

const refused = (value: unknown) => {
  const result = decoded(value)
  expect(Result.isFailure(result)).toBe(true)
  Result.match(result, {
    onSuccess: () => undefined,
    onFailure: (failure) => {
      expect(failure).toBeInstanceOf(ConfigUndecodable)
    },
  })
}

describe("decodeForemanConfig", () => {
  it("decodes every field and defaults each role's estimate to initialEstimate", () => {
    const config = Result.getOrUndefined(decoded(file()))
    expect(config).toEqual({
      projectId: "foreman",
      stateDir: "/state",
      ownerCheckout: "/owner",
      supervisor: { path: "/state/worktree", name: "assisted" },
      attributeAllowance: { rootLines: ["* text=auto"] },
      pins,
      claudeSettings: "/state/claude-settings.json",
      estimates: {
        [Roles.Implementer]: defaultPolicy.initialEstimate,
        [Roles.Reviewer]: defaultPolicy.initialEstimate,
        [Roles.Corrector]: defaultPolicy.initialEstimate,
      },
    })
  })

  it("keeps given estimates", () => {
    const estimates = { [Roles.Implementer]: 20, [Roles.Reviewer]: 5, [Roles.Corrector]: 10 }
    expect(Result.getOrUndefined(decoded(file({ estimates })))?.estimates).toEqual(estimates)
  })

  it("refuses text that is not JSON", () => {
    expect(Result.isFailure(decodeForemanConfig("{ projectId: foreman"))).toBe(true)
  })

  it("refuses an unknown key at the top level", () => {
    refused(file({ bypass: true }))
  })

  it("refuses an unknown key inside the supervisor object", () => {
    refused(file({ supervisor: { path: "/w", name: "a", branch: "main" } }))
  })

  it("refuses a relative path", () => {
    refused(file({ stateDir: "state" }))
    refused(file({ claudeSettings: "./settings.json" }))
    refused(file({ supervisor: { path: "worktree", name: "assisted" } }))
  })

  it("refuses a missing pin", () => {
    refused(file({ pins: { [Clients.Claude]: "2.1.328 (Claude Code)" } }))
  })

  it("refuses an empty pin", () => {
    refused(file({ pins: { ...pins, [Clients.Codex]: "" } }))
  })

  it("refuses an allowance line holding a newline", () => {
    refused(file({ attributeAllowance: { rootLines: ["a\nb"] } }))
  })

  it("refuses an estimate above 100 points or a missing role", () => {
    refused(file({ estimates: { [Roles.Implementer]: 101, [Roles.Reviewer]: 5, [Roles.Corrector]: 5 } }))
    refused(file({ estimates: { [Roles.Implementer]: 15 } }))
  })

  it("refuses a missing required key", () => {
    const missing: Record<string, unknown> = file()
    delete missing.ownerCheckout
    refused(missing)
  })
})
