// The configuration file decoder (plan "Slice A1", Format
// `foreman-config.ts`; decisions P4 and P5): strict JSON, every path
// absolute, both client pins present, unknown keys refused, and no
// per-role grant estimate (decision P5, batch review B10).
import { describe, expect, it } from "@effect/vitest"
import { Option, Result } from "effect"
import { Clients } from "../../src/domain/clients.ts"
import { Roles } from "../../src/domain/roles.ts"
import { ConfigUndecodable, decodeForemanConfig, type ForemanConfig, ledgerDirOf } from "../../src/format/foreman-config.ts"

const pins = { [Clients.Claude]: "2.1.328 (Claude Code)", [Clients.Codex]: "codex-cli 0.170.0" }

const file = (overrides: Record<string, unknown> = {}) => ({
  projectId: "foreman",
  stateDir: "/state",
  ownerCheckout: "/owner",
  supervisor: { path: "/state/worktree", name: "assisted" },
  attributeAllowance: { rootLines: ["* text=auto"] },
  pins,
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
  it("decodes every field", () => {
    const config = Result.getOrUndefined(decoded(file()))
    expect(config).toEqual({
      projectId: "foreman",
      stateDir: "/state",
      ownerCheckout: "/owner",
      supervisor: { path: "/state/worktree", name: "assisted" },
      ledgerDir: Option.none(),
      attributeAllowance: { rootLines: ["* text=auto"] },
      pins,
    })
  })

  it("keeps a configured ledger directory and refuses a relative or unnormalized one", () => {
    expect(Result.map(decoded(file({ ledgerDir: "/ledger" })), (config) => config.ledgerDir)).toEqual(
      Result.succeed(Option.some("/ledger")),
    )
    refused(file({ ledgerDir: "ledger" }))
    refused(file({ ledgerDir: "/a/../ledger" }))
  })

  it("refuses estimates: every role reserves the policy's initialEstimate (P5, B10)", () => {
    refused(file({ estimates: { [Roles.Implementer]: 15, [Roles.Reviewer]: 15, [Roles.Corrector]: 15 } }))
    refused(file({ estimates: { [Roles.Implementer]: 0, [Roles.Reviewer]: 0, [Roles.Corrector]: 0 } }))
  })

  it("puts the ledger in the configured directory, else in <HOME>/.foreman", () => {
    const decodedConfig = (value: unknown): ForemanConfig =>
      Result.getOrElse(decoded(value), () => expect.unreachable("the file decodes"))
    expect(ledgerDirOf(decodedConfig(file({ ledgerDir: "/ledger" })), Option.some("/home/o"))).toEqual(Result.succeed("/ledger"))
    expect(ledgerDirOf(decodedConfig(file()), Option.some("/home/o"))).toEqual(Result.succeed("/home/o/.foreman"))
    expect(Result.isFailure(ledgerDirOf(decodedConfig(file()), Option.none()))).toBe(true)
    expect(Result.isFailure(ledgerDirOf(decodedConfig(file()), Option.some("home")))).toBe(true)
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
    refused(file({ supervisor: { path: "worktree", name: "assisted" } }))
  })

  it("refuses a Claude settings file: foreman writes the editing profile itself (B03)", () => {
    refused(file({ claudeSettings: "/state/claude-settings.json" }))
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

  it("refuses a missing required key", () => {
    const missing: Record<string, unknown> = file()
    delete missing.ownerCheckout
    refused(missing)
  })
})
