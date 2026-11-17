// Single-value `git rev-parse` output: exactly one trailing newline is
// removed, so a path containing or ending in a newline survives.
import { describe, expect, it } from "@effect/vitest"
import { Result } from "effect"
import { decodeRevParseLine, decodeRevParsePath } from "../../src/format/rev-parse.ts"

describe("decodeRevParsePath", () => {
  it("removes the one trailing newline", () => {
    expect(decodeRevParsePath("/state/worktree\n")).toEqual(Result.succeed("/state/worktree"))
  })

  it("keeps a newline inside the path", () => {
    expect(decodeRevParsePath("/state/work\ntree\n")).toEqual(Result.succeed("/state/work\ntree"))
  })

  it("keeps a newline that ends the path", () => {
    expect(decodeRevParsePath("/state/worktree\n\n")).toEqual(Result.succeed("/state/worktree\n"))
  })

  it("keeps surrounding spaces", () => {
    expect(decodeRevParsePath("/state/ tree \n")).toEqual(Result.succeed("/state/ tree "))
  })

  it("fails without a trailing newline", () => {
    expect(Result.isFailure(decodeRevParsePath("/state/worktree"))).toBe(true)
  })

  it("fails on a relative path", () => {
    expect(Result.isFailure(decodeRevParsePath(".git\n"))).toBe(true)
  })

  it("fails on empty output", () => {
    expect(Result.isFailure(decodeRevParsePath(""))).toBe(true)
  })
})

describe("decodeRevParseLine", () => {
  it("decodes a ref name", () => {
    expect(decodeRevParseLine("refs/heads/foreman/x\n")).toEqual(Result.succeed("refs/heads/foreman/x"))
  })

  it("decodes a detached HEAD's output as HEAD", () => {
    expect(decodeRevParseLine("HEAD\n")).toEqual(Result.succeed("HEAD"))
  })

  it("fails on a lone newline", () => {
    expect(Result.isFailure(decodeRevParseLine("\n"))).toBe(true)
  })
})
