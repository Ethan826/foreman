// The creation prechecks, moved out of Runtime (owner ruling on R2 and R3
// of the B11a review): the destination must be absolute, the branch must
// not exist (from `rev-parse --verify --quiet`'s exit code) and nothing may
// be at the path (from `stat`). Pure functions over raw results.
import { describe, expect, it } from "@effect/vitest"
import { Option, Result } from "effect"
import {
  GitCommandFailed,
  WorktreeBranchExists,
  WorktreePathExists,
  WorktreePathNotAbsolute,
} from "../../src/domain/worktree.ts"
import { refuseExistingBranch, refuseExistingPath, requireAbsolute } from "../../src/features/worktree-precheck.ts"

const probeArgs = ["rev-parse", "--verify", "--quiet", "refs/heads/foreman/t"]

const probe = (exitCode: number) => ({ args: probeArgs, exitCode, stderr: "stderr text" })

describe("requireAbsolute", () => {
  it("passes an absolute path", () => {
    expect(requireAbsolute("/state/worktree")).toEqual(Result.succeed("/state/worktree"))
  })

  it("passes an absolute path whose last segment starts with a dash", () => {
    expect(requireAbsolute("/state/-worktree")).toEqual(Result.succeed("/state/-worktree"))
  })

  it("refuses a relative path", () => {
    expect(requireAbsolute("worktree")).toEqual(Result.fail(new WorktreePathNotAbsolute({ path: "worktree" })))
  })

  it("refuses a dash-prefixed path", () => {
    expect(requireAbsolute("-worktree")).toEqual(Result.fail(new WorktreePathNotAbsolute({ path: "-worktree" })))
  })

  it("refuses an empty path", () => {
    expect(requireAbsolute("")).toEqual(Result.fail(new WorktreePathNotAbsolute({ path: "" })))
  })
})

describe("refuseExistingBranch", () => {
  it("refuses when the ref resolves (exit 0)", () => {
    expect(refuseExistingBranch("foreman/t", probe(0))).toEqual(
      Result.fail(new WorktreeBranchExists({ branch: "foreman/t" })),
    )
  })

  it("passes when the ref is missing (exit 1)", () => {
    expect(refuseExistingBranch("foreman/t", probe(1))).toEqual(Result.void)
  })

  it("keeps the args, exit code and stderr of any other exit", () => {
    expect(refuseExistingBranch("foreman/t", probe(128))).toEqual(
      Result.fail(new GitCommandFailed({ args: probeArgs, exitCode: Option.some(128), stderr: "stderr text" })),
    )
  })
})

describe("refuseExistingPath", () => {
  it("passes when nothing is at the path", () => {
    expect(refuseExistingPath("/state/worktree", Option.none())).toEqual(Result.void)
  })

  it("refuses a directory, even an empty one", () => {
    expect(refuseExistingPath("/state/worktree", Option.some({ directory: true }))).toEqual(
      Result.fail(new WorktreePathExists({ path: "/state/worktree" })),
    )
  })

  it("refuses a file", () => {
    expect(refuseExistingPath("/state/worktree", Option.some({ directory: false }))).toEqual(
      Result.fail(new WorktreePathExists({ path: "/state/worktree" })),
    )
  })
})
