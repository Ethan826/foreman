// The strict decoder for the review brief's changed paths, `git
// diff-tree -r --name-status -z` output (plan "Profiles, environment and
// briefs"). Fixtures follow git 2.50.1 as probed on 2026-11-19: the
// status, then each path, every field ending in a NUL; a rename or copy
// has a three-digit score and two paths.
import { describe, expect, it } from "@effect/vitest"
import { Option, Result } from "effect"
import {
  decodeNameStatus,
  NameStatusUndecodable,
  type ChangedPath,
} from "../../src/format/name-status.ts"

const commitId = "78981922613b2afb6025042ff6bd878ac1994e85"

const single = (status: string, path: string): ChangedPath => ({
  status,
  source: Option.none(),
  path,
})

const moved = (status: string, source: string, path: string): ChangedPath => ({
  status,
  source: Option.some(source),
  path,
})

describe("decodeNameStatus", () => {
  it("decodes each status with its path or paths", () => {
    const output =
      "M\0a\0A\0b c\0D\0d\0R100\0old\0new\0C075\0src\0copy\0T\0link\0"
    expect(decodeNameStatus(output)).toEqual(
      Result.succeed([
        single("M", "a"),
        single("A", "b c"),
        single("D", "d"),
        moved("R100", "old", "new"),
        moved("C075", "src", "copy"),
        single("T", "link"),
      ]),
    )
  })

  it("keeps tabs and newlines in a path", () => {
    expect(decodeNameStatus("M\0a\tb\nc\0")).toEqual(
      Result.succeed([single("M", "a\tb\nc")]),
    )
  })

  it("decodes empty output as no changes", () => {
    expect(decodeNameStatus("")).toEqual(Result.succeed([]))
  })

  const malformed = {
    "an unknown status letter": "X\0a\0",
    "an unmerged entry": "U\0a\0",
    "a lowercase letter": "m\0a\0",
    "a rename without a score": "R\0a\0b\0",
    "a score above 100": "R101\0a\0b\0",
    "a modification with a score": "M090\0a\0",
    "a missing final NUL": "M\0a",
    "text after the last NUL": "M\0a\0M",
    "a status with no path": "M\0",
    "a rename with one path": "R100\0a\0",
    "an empty path": "M\0\0",
    "a commit id before the records": `${commitId}\0M\0a\0`,
  }

  it.each(Object.entries(malformed))("refuses %s", (_name, output) => {
    const failure = Option.getOrUndefined(
      Result.getFailure(decodeNameStatus(output)),
    )
    expect(failure).toBeInstanceOf(NameStatusUndecodable)
  })
})
