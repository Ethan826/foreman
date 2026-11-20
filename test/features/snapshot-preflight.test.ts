// The snapshot preflight's decisions (review finding B08, M14): which
// base entries are gitlinks, and for each listed directory whether the
// walk descends into an entry or records a finding, and whether git must
// first say the path is not ignored. Paths the base tracks, and the
// directories above them, are covered whatever the ignore rules say.
import { describe, expect, it } from "@effect/vitest"
import { FileKinds, TreeEntryTypes, type FileKind, type TreeEntry, type TreeEntryType } from "../../src/domain/attributes.ts"
import { Revision } from "../../src/domain/ids.ts"
import { GitlinkInBase, NestedRepository, SpecialFile, WalkFound, WalkInto } from "../../src/domain/snapshot.ts"
import { baseGitlinks, coverageOf, rootDirectory, walkSteps } from "../../src/features/snapshot-preflight.ts"

const entry = (path: string, mode = "100644", type: TreeEntryType = TreeEntryTypes.Blob): TreeEntry => ({
  mode,
  type,
  object: Revision.make("a".repeat(40)),
  path,
})

const child = (name: string, kind: FileKind) => ({ name, kind })

describe("baseGitlinks", () => {
  it("lists every gitlink of the base tree in tree order", () => {
    const base = [entry("a.txt"), entry("lib", "160000", TreeEntryTypes.Commit), entry("z/mod", "160000", TreeEntryTypes.Commit)]
    expect(baseGitlinks(base)).toEqual([new GitlinkInBase({ path: "lib" }), new GitlinkInBase({ path: "z/mod" })])
  })

  it("lists nothing for a tree of blobs", () => {
    expect(baseGitlinks([entry("a.txt"), entry("link", "120000")])).toEqual([])
  })
})

describe("walkSteps at the top level", () => {
  const coverage = coverageOf([entry("a.txt"), entry("build/kept.txt")], ["build/", "logs/", "ign.txt"])

  it("skips the worktree's own .git and regular files and links", () => {
    const steps = walkSteps(coverage, rootDirectory, [
      child(".git", FileKinds.File),
      child("a.txt", FileKinds.File),
      child("link", FileKinds.SymbolicLink),
    ])
    expect(steps).toEqual([])
  })

  it("descends into a plain directory without asking git", () => {
    expect(walkSteps(coverage, rootDirectory, [child("src", FileKinds.Directory)])).toEqual([
      new WalkInto({ path: "src", unlessIgnored: false }),
    ])
  })

  it("descends into a directory git lists as ignored only if git says it is not ignored", () => {
    expect(walkSteps(coverage, rootDirectory, [child("logs", FileKinds.Directory)])).toEqual([
      new WalkInto({ path: "logs", unlessIgnored: true }),
    ])
  })

  it("descends into an ignored directory that holds a base path without asking git", () => {
    expect(walkSteps(coverage, rootDirectory, [child("build", FileKinds.Directory)])).toEqual([
      new WalkInto({ path: "build", unlessIgnored: false }),
    ])
  })

  it("records a special file unless git says it is ignored", () => {
    expect(walkSteps(coverage, rootDirectory, [child("pipe", FileKinds.Other)])).toEqual([
      new WalkFound({ finding: new SpecialFile({ path: "pipe" }), unlessIgnored: true }),
    ])
  })

  it("records a special file at a base path whatever git's ignore rules say", () => {
    expect(walkSteps(coverage, rootDirectory, [child("a.txt", FileKinds.Other)])).toEqual([
      new WalkFound({ finding: new SpecialFile({ path: "a.txt" }), unlessIgnored: false }),
    ])
  })
})

describe("walkSteps below the top level", () => {
  const coverage = coverageOf([entry("tracked/file.txt")], [])

  it("records a directory holding .git as a nested repository and does not descend", () => {
    const steps = walkSteps(coverage, "vendor/lib", [child(".git", FileKinds.Directory), child("src", FileKinds.Directory)])
    expect(steps).toEqual([new WalkFound({ finding: new NestedRepository({ path: "vendor/lib" }), unlessIgnored: true })])
  })

  it("records a nested repository at a directory above a base path without asking git", () => {
    const steps = walkSteps(coverage, "tracked", [child(".git", FileKinds.File), child("file.txt", FileKinds.File)])
    expect(steps).toEqual([new WalkFound({ finding: new NestedRepository({ path: "tracked" }), unlessIgnored: false })])
  })

  it("joins a child's name to its directory's path", () => {
    expect(walkSteps(coverage, "src/run", [child("sock", FileKinds.Other), child("deep", FileKinds.Directory)])).toEqual([
      new WalkFound({ finding: new SpecialFile({ path: "src/run/sock" }), unlessIgnored: true }),
      new WalkInto({ path: "src/run/deep", unlessIgnored: false }),
    ])
  })
})
