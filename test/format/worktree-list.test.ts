// Fixtures follow the output of git 2.50.1 `git worktree list --porcelain
// -z` as probed on 2026-11-17: each attribute line ends in NUL and each
// record ends in one more NUL. They hold a main entry, a locked entry with a
// reason (`--lock --reason foreman`), one locked with no reason (`git
// worktree lock` without `--reason`), a detached entry and a bare
// repository's entry. Without `-z`, git quotes a lock reason such as
// `say "hi"<TAB>tab` and a newline in a path splits its record; with `-z`
// both come through verbatim.
import { describe, expect, it } from "@effect/vitest"
import { Option, Result } from "effect"
import { decodeWorktreeList } from "../../src/format/worktree-list.ts"

const head = "065520b4b20208064890d33a402c12fb5bac9e47"

/** NUL-terminated attribute lines, then the NUL that ends the record. */
const record = (lines: ReadonlyArray<string>) => `${lines.map((line) => `${line}\0`).join("")}\0`

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
]
  .join("\n")
  .split("\n\n")
  .map((block) => record(block.split("\n")))
  .join("")

const decoded = (text: string) =>
  Result.getOrElse(decodeWorktreeList(text), () => [])

describe("git worktree list --porcelain -z", () => {
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
    expect(decoded(record(["worktree /repo/b.git", "bare"]))).toEqual([
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
    expect(Result.isFailure(decodeWorktreeList(record([`HEAD ${head}`])))).toBe(true)
  })

  it("fails on a HEAD that is not an object id", () => {
    expect(Result.isFailure(decodeWorktreeList(record(["worktree /a", "HEAD abc"])))).toBe(true)
  })

  it("keeps a newline, a space and quotes in a path verbatim", () => {
    const path = '/state/work "tree"\nline'
    expect(decoded(record([`worktree ${path}`, `HEAD ${head}`, "detached"]))[0]?.path).toBe(path)
  })

  it("keeps a lock reason with quotes and a tab verbatim", () => {
    const reason = 'say "hi"\ttab'
    expect(decoded(record(["worktree /a", `HEAD ${head}`, "detached", `locked ${reason}`]))[0]?.lock).toEqual(
      Option.some({ reason: Option.some(reason) }),
    )
  })

  it("splits records only at an empty field", () => {
    const two = `${record(["worktree /a", "bare"])}${record(["worktree /b", "bare"])}`
    expect(decoded(two).map((entry) => entry.path)).toEqual(["/a", "/b"])
  })
})
