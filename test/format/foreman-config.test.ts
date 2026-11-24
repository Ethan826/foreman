// The configuration file decoder (plan "Slice A1", Format
// `foreman-config.ts`; decisions P4 and P5): strict JSON, every path
// absolute, both client pins present, unknown keys refused, and no
// per-role grant estimate (decision P5, batch review B10). Check commands
// are optional, and a malformed one refuses the file with a reason that
// names it (dogfood-3b; owner ruling of 2026-11-24).
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Formatter, Option, Result, String } from "effect"
import { waxwingRootLine } from "../../src/domain/attributes.ts"
import { Clients } from "../../src/domain/clients.ts"
import { Roles } from "../../src/domain/roles.ts"
import { ConfigUndecodable, decodeForemanConfig, type ForemanConfig, ledgerDirOf } from "../../src/format/foreman-config.ts"

const pins = { [Clients.Claude]: "2.1.328 (Claude Code)", [Clients.Codex]: "codex-cli 0.170.0" }

const file = (overrides: Record<string, unknown> = {}) => ({
  projectId: "foreman",
  stateDir: "/state",
  ownerCheckout: "/owner",
  supervisor: { path: "/state/worktree", name: "assisted" },
  attributeAllowance: { rootLines: [waxwingRootLine] },
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

/** A command of `length` letters. */
const commandOf = (length: number) => Arr.join(Arr.makeBy(length, () => "a"), "")

/** Valid check commands, using every character the rule allows. */
const validCommands = ["bun run verify", "bun run test -- test/a_b.ts", "make check PORT=8080 user@host:/x+y", commandOf(200)]

/** Each entry the decoder refuses on its own (dogfood-3b). */
const malformedCommands = [
  "",
  commandOf(201),
  "bun run verify; rm -rf x",
  "bun run 'x'",
  "bun\trun",
  "bun run *",
  " bun run verify",
  "bun run verify ",
  "bun  run verify",
  "git",
  "git log",
  "curl",
  "curl x",
]

const keepsCheckCommands = () => {
  expect(Result.map(decoded(file({ checkCommands: validCommands })), (config) => config.checkCommands)).toEqual(
    Result.succeed(validCommands),
  )
  expect(Result.map(decoded(file({ checkCommands: [] })), (config) => config.checkCommands)).toEqual(Result.succeed([]))
  expect(Result.map(decoded(file()), (config) => config.checkCommands)).toEqual(Result.succeed([]))
}

/** Requires that decoding with `commands` fails with `ConfigUndecodable` whose reason names `named`. */
const refusedNaming = (commands: ReadonlyArray<string>, named: string) => {
  const reason = Result.match(decoded(file({ checkCommands: commands })), {
    onSuccess: () => expect.unreachable(`${Formatter.formatJson(named)} decodes`),
    onFailure: (failure) => failure.reason,
  })
  expect(reason).toContain(`the check command ${Formatter.formatJson(named)} `)
}

const refusesEachMalformedCommand = () => {
  Arr.forEach(malformedCommands, (command) => {
    refusedNaming(["bun run verify", command], command)
  })
}

const refusesDuplicateCommand = () => {
  refusedNaming(["bun run verify", "bun run test", "bun run verify"], "bun run verify")
}

/** `text` repeated `count` times. */
const repeated = (text: string, count: number) => Arr.join(Arr.makeBy(count, () => text), "")

/**
 * The configuration file's text with the check commands `bun run verify`
 * and then `entry`, given as raw JSON text so that it may be a number JSON
 * cannot round-trip, such as `1e400`.
 */
const fileWithRawEntry = (entry: string) =>
  `{"projectId":"foreman","stateDir":"/state","ownerCheckout":"/owner",` +
  `"supervisor":{"path":"/state/worktree","name":"assisted"},` +
  `"attributeAllowance":{"rootLines":${JSON.stringify([waxwingRootLine])}},` +
  `"pins":${JSON.stringify(pins)},"checkCommands":["bun run verify",${entry}]}`

/**
 * Requires that the raw JSON `entry`, second in the list, fails decoding
 * with `ConfigUndecodable` whose reason gives index 1 and `kind`, and
 * stays short.
 */
const refusedAsKind = (entry: string, kind: string) => {
  const reason = Result.match(decodeForemanConfig(fileWithRawEntry(entry)), {
    onSuccess: () => expect.unreachable(`the entry of kind ${kind} decodes`),
    onFailure: (failure) => failure.reason,
  })
  expect(reason).toContain(`the check command at index 1 is ${kind}, not a string`)
  expect(String.length(reason)).toBeLessThan(400)
}

/** Entries that are not strings, as raw JSON, each with the kind the reason gives (owner finding F2). */
const nonStringCommands: ReadonlyArray<readonly [string, string]> = [
  ["42", "a number"],
  ["null", "null"],
  ["true", "a boolean"],
  ['["bun"]', "a list"],
  ['{"run":"verify"}', "an object"],
]

const refusesNonStringCommand = () => {
  Arr.forEach(nonStringCommands, ([entry, kind]) => {
    refusedAsKind(entry, kind)
  })
}

/** A list nested 5,000 deep: formatting it as JSON overflowed the stack (second correction, F2). */
const refusesDeeplyNestedCommand = () => {
  refusedAsKind(`${repeated("[", 5000)}${repeated("]", 5000)}`, "a list")
}

/** `1e400` parses to Infinity, which JSON formats as `null` (second correction, F2). */
const refusesOverflowingNumberCommand = () => {
  refusedAsKind("1e400", "a number")
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
      attributeAllowance: { rootLines: [waxwingRootLine] },
      pins,
      checkCommands: [],
    })
  })

  it("keeps the configured check commands in order, and none when the key is absent", keepsCheckCommands)

  it("refuses each malformed check command, with a reason that names it", refusesEachMalformedCommand)

  it("refuses a check command listed twice, naming it", refusesDuplicateCommand)

  it("refuses a check command that is not a string, naming its index and kind", refusesNonStringCommand)

  it("refuses a deeply nested check command by index and kind, with a short reason", refusesDeeplyNestedCommand)

  it("refuses the check command 1e400 as a number, naming its index", refusesOverflowingNumberCommand)

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

  it("refuses any allowance line but Waxwing's, and Waxwing's twice (B06)", () => {
    refused(file({ attributeAllowance: { rootLines: ["a\nb"] } }))
    refused(file({ attributeAllowance: { rootLines: ["* text=auto"] } }))
    refused(file({ attributeAllowance: { rootLines: ["*.txt filter=evil"] } }))
    refused(file({ attributeAllowance: { rootLines: ["[attr]binary -diff"] } }))
    refused(file({ attributeAllowance: { rootLines: [waxwingRootLine, waxwingRootLine] } }))
    refused(file({ attributeAllowance: { rootLines: [`${waxwingRootLine} `] } }))
  })

  it("keeps no allowance line", () => {
    expect(Result.map(decoded(file({ attributeAllowance: { rootLines: [] } })), (config) => config.attributeAllowance)).toEqual(
      Result.succeed({ rootLines: [] }),
    )
  })

  it("refuses a missing required key", () => {
    const missing: Record<string, unknown> = file()
    delete missing.ownerCheckout
    refused(missing)
  })
})
