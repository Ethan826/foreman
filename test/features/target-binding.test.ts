// Comparing a configured target with the recorded binding (batch review
// B04), and the binding file's text. Production cases are in
// test/program/production-binding.test.ts.
import { describe, expect, it } from "@effect/vitest"
import { Result } from "effect"
import { waxwingRootLine } from "../../src/domain/attributes.ts"
import { ProjectId } from "../../src/domain/ids.ts"
import { type TargetBinding, TargetMismatch } from "../../src/domain/target.ts"
import { compareTarget } from "../../src/features/target-binding.ts"
import { decodeTargetBinding, encodeTargetBinding } from "../../src/format/target-binding.ts"

const recorded: TargetBinding = {
  projectId: ProjectId.make("alpha"),
  ownerCheckout: "/o/repo",
  supervisor: { path: "/o/state/worktree", name: "t" },
  ledger: "/o/.foreman/ledger.sqlite",
  attributeAllowance: { rootLines: [] },
}

const binding = "/o/state/target-binding.json"

describe("compareTarget", () => {
  it("passes the same target", () => {
    expect(compareTarget(binding, recorded, { ...recorded })).toEqual(Result.void)
  })

  it("lists every field that differs, recorded value first", () => {
    const configured: TargetBinding = {
      ...recorded,
      projectId: ProjectId.make("beta"),
      attributeAllowance: { rootLines: [waxwingRootLine] },
    }
    expect(compareTarget(binding, recorded, configured)).toEqual(
      Result.fail(
        new TargetMismatch({
          binding,
          differences: ['projectId: recorded "alpha", configured "beta"', 'attributeAllowance: recorded {"rootLines":[]}, configured {"rootLines":["*.wxw linguist-language=Rust"]}'],
        }),
      ),
    )
  })

  it("compares the supervisor's path and name, the owner's checkout and the ledger", () => {
    for (const configured of [
      { ...recorded, ownerCheckout: "/o/other" },
      { ...recorded, supervisor: { path: "/o/elsewhere", name: "t" } },
      { ...recorded, supervisor: { path: "/o/state/worktree", name: "u" } },
      { ...recorded, ledger: "/o/ledger2/ledger.sqlite" },
    ]) {
      expect(Result.isFailure(compareTarget(binding, recorded, configured))).toBe(true)
    }
  })
})

describe("the binding file", () => {
  it("round-trips and refuses an unknown key", () => {
    expect(decodeTargetBinding(encodeTargetBinding(recorded))).toEqual(Result.succeed(recorded))
    expect(Result.isFailure(decodeTargetBinding('{"extra": 1}'))).toBe(true)
  })
})
