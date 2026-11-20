// The layout rules (batch review B05) over canonical paths. Production
// cases, with links and paths not made yet, are in
// test/program/production-layout.test.ts.
import { describe, expect, it } from "@effect/vitest"
import { Result } from "effect"
import { LayoutRefused } from "../../src/domain/layout.ts"
import { checkLayout, isWithin } from "../../src/features/layout.ts"

const approved = { stateDir: "/home/o/state", ownerCheckout: "/home/o/repo", supervisor: "/home/o/state/worktree", ledgerDir: "/home/o/.foreman" }

const reasons = (layout: typeof approved) =>
  Result.match(checkLayout(layout), { onSuccess: () => [], onFailure: (refused) => refused.reasons })

describe("isWithin", () => {
  it("compares whole components", () => {
    expect(isWithin("/a/b", "/a/b")).toBe(true)
    expect(isWithin("/a/b/c", "/a/b")).toBe(true)
    expect(isWithin("/a/bc", "/a/b")).toBe(false)
    expect(isWithin("/a", "/a/b")).toBe(false)
    expect(isWithin("/anything", "/")).toBe(true)
  })
})

describe("checkLayout", () => {
  it("passes the design's layout: the worktree inside the state directory, everything outside the owner's checkout", () => {
    expect(checkLayout(approved)).toEqual(Result.void)
  })

  it("passes a sibling whose name only starts with the owner's", () => {
    expect(checkLayout({ ...approved, stateDir: "/home/o/repo-state", supervisor: "/home/o/repo-state/wt" })).toEqual(Result.void)
  })

  it("names every broken rule with both paths", () => {
    expect(reasons({ ...approved, stateDir: "/home/o/repo/s", supervisor: "/home/o/repo/s/wt", ledgerDir: "/home/o/repo/s/wt/l" })).toEqual([
      "the state directory is inside the owner's checkout: /home/o/repo/s is within /home/o/repo",
      "the supervisor worktree is inside the owner's checkout: /home/o/repo/s/wt is within /home/o/repo",
      "the ledger directory is inside the supervisor worktree: /home/o/repo/s/wt/l is within /home/o/repo/s/wt",
    ])
  })

  it("refuses the owner's checkout inside the worktree and the state directory at the worktree", () => {
    expect(checkLayout({ ...approved, supervisor: "/home/o" })).toEqual(
      Result.fail(
        new LayoutRefused({
          reasons: [
            "the owner's checkout is inside the supervisor worktree: /home/o/repo is within /home/o",
            "the state directory is inside the supervisor worktree: /home/o/state is within /home/o",
            "the ledger directory is inside the supervisor worktree: /home/o/.foreman is within /home/o",
          ],
        }),
      ),
    )
  })
})
