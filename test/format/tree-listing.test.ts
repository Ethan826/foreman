// Fixtures follow git 2.50.1 `git ls-tree --full-tree -r -t -z` as probed
// on 2026-11-19: `<mode> SP <type> SP <object> TAB <path>` and a NUL after
// each record, the path verbatim. Every record that does not have that
// shape makes the run undecodable, which the attribute check refuses
// (plan B11c, R5's lesson).
import { describe, expect, it } from "@effect/vitest"
import { TreeEntries, TreeEntryTypes, TreeNotListed, TreeUndecodable } from "../../src/domain/attributes.ts"
import { Revision } from "../../src/domain/ids.ts"
import { decodeTreeRun } from "../../src/format/tree-listing.ts"

const blob = "78981922613b2afb6025042ff6bd878ac1994e85"
const tree = "a1dffc7a64c0b2d395484bf452e9aeb1da3a18f2"

const exited0 = (stdout: string) => ({ exitCode: 0, stdout, stderr: "" })

describe("decodeTreeRun", () => {
  it("decodes each NUL-terminated record, with tabs, spaces and newlines in the path kept", () => {
    const stdout = `100644 blob ${blob}\ta b\tc\nd\x00040000 tree ${tree}\tsub\x00160000 commit ${blob}\tmod\x00`
    expect(decodeTreeRun(exited0(stdout))).toEqual(
      new TreeEntries({
        entries: [
          { mode: "100644", type: TreeEntryTypes.Blob, object: Revision.make(blob), path: "a b\tc\nd" },
          { mode: "040000", type: TreeEntryTypes.Tree, object: Revision.make(tree), path: "sub" },
          { mode: "160000", type: TreeEntryTypes.Commit, object: Revision.make(blob), path: "mod" },
        ],
      }),
    )
  })

  it("decodes empty output as no entries", () => {
    expect(decodeTreeRun(exited0(""))).toEqual(new TreeEntries({ entries: [] }))
  })

  it("keeps a non-zero exit with its stderr, decoding nothing", () => {
    expect(decodeTreeRun({ exitCode: 128, stdout: "", stderr: "fatal: not a tree\n" })).toEqual(
      new TreeNotListed({ exitCode: 128, stderr: "fatal: not a tree\n" }),
    )
  })

  const malformed = {
    "a missing final NUL": `100644 blob ${blob}\ta`,
    "an empty record": `100644 blob ${blob}\ta\x00\x00`,
    "an unknown type": `100644 blobby ${blob}\ta\x00`,
    "foreman's own name for a type, which git never prints": `100644 ${TreeEntryTypes.Blob} ${blob}\ta\x00`,
    "a short mode": `10644 blob ${blob}\ta\x00`,
    "a non-octal mode": `100648 blob ${blob}\ta\x00`,
    "a short object id": `100644 blob ${blob.slice(1)}\ta\x00`,
    "an uppercase object id": `100644 blob ${blob.toUpperCase()}\ta\x00`,
    "two spaces": `100644  blob ${blob}\ta\x00`,
    "no tab": `100644 blob ${blob} a\x00`,
    "an empty path": `100644 blob ${blob}\t\x00`,
    "one good record then a bad one": `100644 blob ${blob}\ta\x00garbage\x00`,
  }

  it.each(Object.entries(malformed))("refuses %s as undecodable", (_name, stdout) => {
    expect(decodeTreeRun(exited0(stdout))).toBeInstanceOf(TreeUndecodable)
  })
})
