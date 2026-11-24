// Whether git's HOME may be used (batch review B02): a real directory,
// not a link, owned by tarlatan's user, mode exactly 0700, and empty. The
// owner case is here because a test cannot make a directory another user
// owns; the rest also run through production in
// test/program/production-home.test.ts.
import { describe, expect, it } from "@effect/vitest"
import { Result } from "effect"
import { GitHomeRefused, HomeAbsent, HomeFound, HomeUnreadable } from "../../src/domain/git-home.ts"
import { judgeGitHome } from "../../src/features/git-home.ts"

const path = "/state/git-home"

const usable = { link: false, directory: true, mode: 0o700, ownerUid: 501, userUid: 501, entries: 0 }

const reasons = (reading: HomeAbsent | HomeFound | HomeUnreadable) =>
  Result.match(judgeGitHome(path, reading), { onSuccess: () => [], onFailure: (refused) => refused.reasons })

describe("judgeGitHome", () => {
  it("passes a private, empty directory owned by tarlatan's user", () => {
    expect(judgeGitHome(path, new HomeFound(usable))).toEqual(Result.void)
  })

  it("refuses another user's directory", () => {
    expect(reasons(new HomeFound({ ...usable, ownerUid: 0 }))).toEqual(["is owned by uid 0, not tarlatan's"])
  })

  it("refuses any mode but 700, narrower included", () => {
    expect(reasons(new HomeFound({ ...usable, mode: 0o750 }))).toEqual(["has mode 750, not 700"])
    expect(reasons(new HomeFound({ ...usable, mode: 0o500 }))).toEqual(["has mode 500, not 700"])
  })

  it("refuses a link, a file and a directory with entries, naming every reason", () => {
    expect(reasons(new HomeFound({ ...usable, link: true, directory: false, mode: 0o755 }))).toEqual([
      "is a symbolic link",
      "has mode 755, not 700",
    ])
    expect(reasons(new HomeFound({ ...usable, directory: false }))).toEqual(["is not a directory"])
    expect(reasons(new HomeFound({ ...usable, entries: 2 }))).toEqual(["is not empty (2 entries)"])
  })

  it("refuses nothing at the path and an unreadable one", () => {
    expect(reasons(new HomeAbsent())).toEqual(["nothing is at the path"])
    expect(judgeGitHome(path, new HomeUnreadable({ reason: "EACCES" }))).toEqual(
      Result.fail(new GitHomeRefused({ path, reasons: ["unreadable: EACCES"] })),
    )
  })
})
