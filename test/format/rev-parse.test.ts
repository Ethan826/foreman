// Single-value `git rev-parse` output: exactly one trailing newline is
// removed, so a path containing or ending in a newline survives.
import { describe, expect, it } from "@effect/vitest"
import { Result } from "effect"
import { IdentityNoRepository, IdentityPrinted, IdentityUnread } from "../../src/domain/worktree.ts"
import {
  decodeIdentityRun,
  decodeRevParseLine,
  decodeRevParsePath,
  decodeRevParseRevision,
} from "../../src/format/rev-parse.ts"

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

describe("decodeRevParseRevision", () => {
  const head = "065520b4b20208064890d33a402c12fb5bac9e47"

  it("decodes `rev-parse HEAD` output as a revision", () => {
    expect(decodeRevParseRevision(`${head}\n`)).toEqual(Result.succeed(head))
  })

  it("fails on output that is not an object id", () => {
    expect(Result.isFailure(decodeRevParseRevision("HEAD\n"))).toBe(true)
  })

  it("fails on empty output", () => {
    expect(Result.isFailure(decodeRevParseRevision(""))).toBe(true)
  })
})

describe("decodeIdentityRun", () => {
  it("decodes a run that exited 0 into the path it printed", () => {
    const run = { exitCode: 0, stdout: "/repo/.git/worktrees/w\n", stderr: "" }
    expect(decodeIdentityRun(run)).toEqual(Result.succeed(new IdentityPrinted({ path: "/repo/.git/worktrees/w" })))
  })

  it("keeps a no-repository exit's code and stderr, and ignores its stdout", () => {
    const run = { exitCode: 128, stdout: "ignored\n", stderr: "fatal: not a git repository\n" }
    expect(decodeIdentityRun(run)).toEqual(
      Result.succeed(new IdentityNoRepository({ exitCode: 128, stderr: "fatal: not a git repository\n" })),
    )
  })

  it.each([
    "fatal: not a git repository (or any of the parent directories): .git\n",
    "fatal: not a git repository (or any parent up to mount point /Volumes)\n",
    "fatal: not a git repository: /gone/.git/worktrees/w\n",
  ])("reads git's no-repository diagnostic %j as no repository", (stderr) => {
    expect(decodeIdentityRun({ exitCode: 128, stdout: "", stderr })).toEqual(
      Result.succeed(new IdentityNoRepository({ exitCode: 128, stderr })),
    )
  })

  it.each([
    "fatal: unable to read git directory: Input/output error\n",
    "error: fatal: not a git repository\n",
    "",
  ])("reads any other non-zero exit, %j, as a read git could not complete", (stderr) => {
    expect(decodeIdentityRun({ exitCode: 128, stdout: "", stderr })).toEqual(
      Result.succeed(new IdentityUnread({ exitCode: 128, stderr })),
    )
  })

  it("fails when a run that exited 0 printed a relative path", () => {
    expect(Result.isFailure(decodeIdentityRun({ exitCode: 0, stdout: ".git\n", stderr: "" }))).toBe(true)
  })
})
