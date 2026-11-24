import { describe, expect, it } from "@effect/vitest"
import { Result } from "effect"
import { WorktreeNotAsCreated } from "../../src/domain/worktree.ts"
import { checkCreated } from "../../src/features/worktree-created.ts"

const requested = { resolvedPath: "/private/state/worktree", branch: "tarlatan/x" }
const found = { toplevel: "/private/state/worktree", headRef: "refs/heads/tarlatan/x" }

const notAsCreated = (toplevel: string, headRef: string) =>
  Result.fail(
    new WorktreeNotAsCreated({
      requestedPath: requested.resolvedPath,
      toplevel,
      expectedRef: "refs/heads/tarlatan/x",
      headRef,
    }),
  )

describe("checkCreated", () => {
  it("passes when the top level is the resolved path and HEAD is the branch", () => {
    expect(checkCreated(requested, found)).toEqual(Result.void)
  })

  it("fails on another top level", () => {
    const other = { ...found, toplevel: "/private/state" }
    expect(checkCreated(requested, other)).toEqual(notAsCreated("/private/state", found.headRef))
  })

  it("fails on another branch", () => {
    const other = { ...found, headRef: "refs/heads/main" }
    expect(checkCreated(requested, other)).toEqual(notAsCreated(found.toplevel, "refs/heads/main"))
  })

  it("fails on a detached HEAD", () => {
    const detached = { ...found, headRef: "HEAD" }
    expect(checkCreated(requested, detached)).toEqual(notAsCreated(found.toplevel, "HEAD"))
  })

  it("does not accept the short branch name as the ref", () => {
    const short = { ...found, headRef: "tarlatan/x" }
    expect(checkCreated(requested, short)).toEqual(notAsCreated(found.toplevel, "tarlatan/x"))
  })
})
