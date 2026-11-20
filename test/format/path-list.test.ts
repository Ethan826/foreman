// The strict decoder for NUL-terminated path lists, as `git ls-files -z`
// prints them (review finding B08): every path ends in a NUL and is
// printed verbatim. Output that does not end in a NUL, or holds an empty
// path, is undecodable, never a shorter list.
import { describe, expect, it } from "@effect/vitest"
import { Result } from "effect"
import { decodePathList, PathListUndecodable } from "../../src/format/path-list.ts"

describe("decodePathList", () => {
  it("decodes each path verbatim, in git's order, with a directory's trailing slash kept", () => {
    expect(decodePathList("build/\0a b\tc\nd\0ign.txt\0")).toEqual(Result.succeed(["build/", "a b\tc\nd", "ign.txt"]))
  })

  it("decodes empty output as no paths", () => {
    expect(decodePathList("")).toEqual(Result.succeed([]))
  })

  it("refuses output that does not end in a NUL", () => {
    expect(decodePathList("build/\0ign.txt")).toEqual(
      Result.fail(new PathListUndecodable({ reason: "the output does not end in a NUL" })),
    )
  })

  it("refuses an empty path", () => {
    expect(decodePathList("a\0\0")).toEqual(Result.fail(new PathListUndecodable({ reason: "a path is empty" })))
  })
})
