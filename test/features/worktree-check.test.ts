import { describe, expect, it } from "@effect/vitest"
import { Option, Result, Schema } from "effect"
import type { WorktreeCondition, WorktreeDirectory, WorktreeEntry } from "../../src/domain/worktree.ts"
import {
  IdentityNoRepository,
  IdentityPrinted,
  WorktreeCheckFailed,
  WorktreeConditions,
  WorktreeRecordInvalid,
} from "../../src/domain/worktree.ts"
import { checkWorktree } from "../../src/features/worktree-check.ts"

const recorded = {
  path: "/state/worktree",
  branch: "foreman/x",
  gitDir: "/repo/owner/.git/worktrees/worktree",
  commonDir: "/repo/owner/.git",
}

/** What `stat` reports for a directory, and for a file. */
const directoryStat = Option.some({ directory: true })
const fileStat = Option.some({ directory: false })

/** An identity command that exited as it does where git sees no repository. */
const noRepository = new IdentityNoRepository({ exitCode: 128, stderr: "fatal: not a git repository" })

/** A directory whose identity commands printed `gitDir` and `commonDir`. */
const directoryPrinting = (gitDir: string, commonDir: string): WorktreeDirectory => ({
  stat: directoryStat,
  identity: Option.some({ gitDir: new IdentityPrinted({ path: gitDir }), commonDir: new IdentityPrinted({ path: commonDir }) }),
})

/** Nothing at the path: no stat result and no identity reads. */
const gone: WorktreeDirectory = { stat: Option.none(), identity: Option.none() }

const present = directoryPrinting(recorded.gitDir, recorded.commonDir)

const check = (entries: ReadonlyArray<WorktreeEntry>, directory: WorktreeDirectory = present) =>
  checkWorktree(recorded, entries, directory)

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
  Result.fail(new WorktreeCheckFailed({ path: recorded.path, branch: recorded.branch, failed }))

describe("checkWorktree (startup check)", () => {
  it("passes when the path is listed on refs/heads/<branch> and locked", () => {
    const good = entry({})
    expect(check([owner, good])).toEqual(Result.succeed(good))
  })

  it("passes when locked without a reason", () => {
    const good = entry({ lock: Option.some({ reason: Option.none() }) })
    expect(check([good])).toEqual(Result.succeed(good))
  })

  it("reports a missing path, and only that", () => {
    expect(check([owner])).toEqual(failedWith(WorktreeConditions.Listed))
  })

  it("reports a missing path on an empty listing", () => {
    expect(check([])).toEqual(failedWith(WorktreeConditions.Listed))
  })

  it("reports an unlocked worktree", () => {
    expect(check([entry({ lock: Option.none() })])).toEqual(
      failedWith(WorktreeConditions.Locked),
    )
  })

  it("reports a different branch", () => {
    const other = entry({ branch: Option.some("refs/heads/foreman/y") })
    expect(check([other])).toEqual(failedWith(WorktreeConditions.OnBranch))
  })

  it("does not accept the short branch name as the ref", () => {
    const short = entry({ branch: Option.some("foreman/x") })
    expect(check([short])).toEqual(failedWith(WorktreeConditions.OnBranch))
  })

  it("reports a detached worktree as not on the branch", () => {
    const detached = entry({ branch: Option.none(), detached: true })
    expect(check([detached])).toEqual(
      failedWith(WorktreeConditions.OnBranch),
    )
  })

  it("reports every failing condition of a listed path", () => {
    const both = entry({ branch: Option.none(), detached: true, lock: Option.none() })
    expect(check([both])).toEqual(
      failedWith(WorktreeConditions.OnBranch, WorktreeConditions.Locked),
    )
  })

  it("matches the path exactly", () => {
    const nearby = entry({ path: `${recorded.path}/` })
    expect(check([nearby])).toEqual(failedWith(WorktreeConditions.Listed))
  })

  it("reports a directory that is gone, and not its identity", () => {
    expect(check([entry({})], gone)).toEqual(failedWith(WorktreeConditions.Present))
  })

  it("reports a directory that is not a git worktree", () => {
    const plain = { stat: directoryStat, identity: Option.some({ gitDir: noRepository, commonDir: noRepository }) }
    expect(check([entry({})], plain)).toEqual(failedWith(WorktreeConditions.Identity))
  })

  it("reports a directory with another git directory", () => {
    const other = directoryPrinting("/other/.git", "/other/.git")
    expect(check([entry({})], other)).toEqual(failedWith(WorktreeConditions.Identity))
  })

  it("reports a directory with the git directory but another common directory", () => {
    const other = directoryPrinting(recorded.gitDir, "/other/.git")
    expect(check([entry({})], other)).toEqual(failedWith(WorktreeConditions.Identity))
  })

  it("reports a file at the path as no directory present, and not its identity", () => {
    const file = { stat: fileStat, identity: Option.none() }
    expect(check([entry({})], file)).toEqual(failedWith(WorktreeConditions.Present))
  })

  it("reports a directory whose common-directory command exited non-zero", () => {
    const half = {
      stat: directoryStat,
      identity: Option.some({ gitDir: new IdentityPrinted({ path: recorded.gitDir }), commonDir: noRepository }),
    }
    expect(check([entry({})], half)).toEqual(failedWith(WorktreeConditions.Identity))
  })

  it("reports the directory with the listing's other failures, in vocabulary order", () => {
    expect(check([entry({ lock: Option.none() })], gone)).toEqual(
      failedWith(WorktreeConditions.Present, WorktreeConditions.Locked),
    )
  })

  it("reports only the listing when the path is not listed, whatever the directory", () => {
    expect(check([owner], gone)).toEqual(failedWith(WorktreeConditions.Listed))
  })

  it("refuses an empty recorded path with a typed failure, without throwing", () => {
    const refused = checkWorktree({ ...recorded, path: "" }, [entry({})], present)
    expect(Option.map(Result.getFailure(refused), Schema.is(WorktreeRecordInvalid))).toEqual(Option.some(true))
  })

  it("refuses an empty recorded branch with a typed failure, without throwing", () => {
    const refused = checkWorktree({ ...recorded, branch: "" }, [entry({})], present)
    expect(Option.map(Result.getFailure(refused), Schema.is(WorktreeRecordInvalid))).toEqual(Option.some(true))
  })
})
