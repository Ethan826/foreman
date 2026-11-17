import { describe, expect, it } from "@effect/vitest"
import { Option, Result } from "effect"
import type { WorktreeCondition, WorktreeEntry } from "../../src/domain/worktree.ts"
import { WorktreeCheckFailed, WorktreeConditions } from "../../src/domain/worktree.ts"
import { checkWorktree } from "../../src/features/worktree-check.ts"

const recorded = { path: "/state/worktree", branch: "foreman/x" }

const entry = (overrides: Partial<WorktreeEntry>): WorktreeEntry => ({
  path: recorded.path,
  head: Option.none(),
  branch: Option.some("refs/heads/foreman/x"),
  detached: false,
  bare: false,
  lock: Option.some({ reason: Option.some("foreman") }),
  ...overrides,
})

const owner = entry({
  path: "/repo/owner",
  branch: Option.some("refs/heads/main"),
  lock: Option.none(),
})

const failedWith = (...failed: [WorktreeCondition, ...Array<WorktreeCondition>]) =>
  Result.fail(new WorktreeCheckFailed({ ...recorded, failed }))

describe("checkWorktree (startup check)", () => {
  it("passes when the path is listed on refs/heads/<branch> and locked", () => {
    const good = entry({})
    expect(checkWorktree(recorded, [owner, good])).toEqual(Result.succeed(good))
  })

  it("passes when locked without a reason", () => {
    const good = entry({ lock: Option.some({ reason: Option.none() }) })
    expect(checkWorktree(recorded, [good])).toEqual(Result.succeed(good))
  })

  it("reports a missing path, and only that", () => {
    expect(checkWorktree(recorded, [owner])).toEqual(failedWith(WorktreeConditions.Listed))
  })

  it("reports a missing path on an empty listing", () => {
    expect(checkWorktree(recorded, [])).toEqual(failedWith(WorktreeConditions.Listed))
  })

  it("reports an unlocked worktree", () => {
    expect(checkWorktree(recorded, [entry({ lock: Option.none() })])).toEqual(
      failedWith(WorktreeConditions.Locked),
    )
  })

  it("reports a different branch", () => {
    const other = entry({ branch: Option.some("refs/heads/foreman/y") })
    expect(checkWorktree(recorded, [other])).toEqual(failedWith(WorktreeConditions.OnBranch))
  })

  it("does not accept the short branch name as the ref", () => {
    const short = entry({ branch: Option.some("foreman/x") })
    expect(checkWorktree(recorded, [short])).toEqual(failedWith(WorktreeConditions.OnBranch))
  })

  it("reports a detached worktree as not on the branch", () => {
    const detached = entry({ branch: Option.none(), detached: true })
    expect(checkWorktree(recorded, [detached])).toEqual(
      failedWith(WorktreeConditions.OnBranch),
    )
  })

  it("reports every failing condition of a listed path", () => {
    const both = entry({ branch: Option.none(), detached: true, lock: Option.none() })
    expect(checkWorktree(recorded, [both])).toEqual(
      failedWith(WorktreeConditions.OnBranch, WorktreeConditions.Locked),
    )
  })

  it("matches the path exactly", () => {
    const nearby = entry({ path: `${recorded.path}/` })
    expect(checkWorktree(recorded, [nearby])).toEqual(failedWith(WorktreeConditions.Listed))
  })
})
