// Fixtures follow the output of git 2.50.1 `git worktree list --porcelain`
// as probed on 2026-11-17: a main entry, a locked entry with a reason
// (`--lock --reason foreman`), one locked with no reason (`git worktree
// lock` without `--reason`), a detached entry and a bare repository's entry.
import { describe, expect, it } from "@effect/vitest"
import { Option, Result } from "effect"
import { decodeWorktreeList } from "../../src/format/worktree-list.ts"

const head = "065520b4b20208064890d33a402c12fb5bac9e47"

const listing = [
  "worktree /repo/owner",
  `HEAD ${head}`,
  "branch refs/heads/main",
  "",
  "worktree /state/worktree",
  `HEAD ${head}`,
  "branch refs/heads/foreman/x",
  "locked foreman",
  "",
  "worktree /state/no-reason",
  `HEAD ${head}`,
  "branch refs/heads/foreman/y",
  "locked",
  "",
  "worktree /state/spaced",
  `HEAD ${head}`,
  "branch refs/heads/foreman/z",
  "locked added with --lock",
  "",
  "worktree /state/detached",
  `HEAD ${head}`,
  "detached",
  "prunable gitdir file points to non-existent location",
  "",
  "",
].join("\n")

const decoded = (text: string) =>
  Result.getOrElse(decodeWorktreeList(text), () => [])

describe("git worktree list --porcelain", () => {
  it("decodes the main entry on its branch, unlocked", () => {
    expect(decoded(listing)[0]).toEqual({
      path: "/repo/owner",
      head: Option.some(head),
      branch: Option.some("refs/heads/main"),
      detached: false,
      bare: false,
      lock: Option.none(),
    })
  })

  it("decodes a locked entry with a reason", () => {
    expect(decoded(listing)[1]?.lock).toEqual(
      Option.some({ reason: Option.some("foreman") }),
    )
  })

  it("decodes a locked entry without a reason", () => {
    expect(decoded(listing)[2]?.lock).toEqual(Option.some({ reason: Option.none() }))
  })

  it("keeps the whole reason when it has spaces", () => {
    expect(decoded(listing)[3]?.lock).toEqual(
      Option.some({ reason: Option.some("added with --lock") }),
    )
  })

  it("decodes a detached entry with no branch and ignores unknown lines", () => {
    expect(decoded(listing)[4]).toEqual({
      path: "/state/detached",
      head: Option.some(head),
      branch: Option.none(),
      detached: true,
      bare: false,
      lock: Option.none(),
    })
  })

  it("decodes five entries and no empty ones", () => {
    expect(decoded(listing)).toHaveLength(5)
  })

  it("decodes a bare repository's entry with no HEAD and no branch", () => {
    expect(decoded("worktree /repo/b.git\nbare\n\n")).toEqual([
      {
        path: "/repo/b.git",
        head: Option.none(),
        branch: Option.none(),
        detached: false,
        bare: true,
        lock: Option.none(),
      },
    ])
  })

  it("decodes empty output as no entries", () => {
    expect(decodeWorktreeList("")).toEqual(Result.succeed([]))
  })

  it("fails on an entry without a worktree line", () => {
    expect(Result.isFailure(decodeWorktreeList(`HEAD ${head}\n\n`))).toBe(true)
  })

  it("fails on a HEAD that is not an object id", () => {
    expect(Result.isFailure(decodeWorktreeList("worktree /a\nHEAD abc\n\n"))).toBe(true)
  })
})
