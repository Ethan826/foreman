import { describe, expect, it } from "@effect/vitest"
import { Result } from "effect"
import { LedgerBound } from "../../src/domain/events.ts"
import { checkLedgerBinding, LedgerMoved } from "../../src/features/binding.ts"

const bound = (path: string) => new LedgerBound({ path })

describe("checkLedgerBinding", () => {
  it("asks to bind a project that has no LedgerBound", () => {
    expect(checkLedgerBinding([], "/l/a.sqlite")).toEqual(Result.succeed("bind"))
  })

  it("accepts the same path", () => {
    expect(checkLedgerBinding([bound("/l/a.sqlite")], "/l/a.sqlite")).toEqual(Result.succeed("bound"))
  })

  it("stops startup when the configured ledger differs from the bound one", () => {
    expect(checkLedgerBinding([bound("/l/a.sqlite")], "/l/b.sqlite")).toEqual(
      Result.fail(new LedgerMoved({ bound: "/l/a.sqlite", configured: "/l/b.sqlite" })),
    )
  })
})
