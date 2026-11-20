// The snapshot's raw checks and the review's currency (plan A2, "Snapshot
// identity and raw checks"). Each tree entry is judged against what
// Runtime found at its path without following a link: a regular file with
// the matching executable bit and blob id for modes 100644 and 100755, a
// symbolic link whose link text has the entry's blob id for mode 120000,
// and a refusal for a gitlink or any other mode. Every mismatch is listed.
import { describe, expect, it } from "@effect/vitest"
import { Revision } from "../../src/domain/ids.ts"
import { TreeEntryTypes, type TreeEntry, type TreeEntryType } from "../../src/domain/attributes.ts"
import {
  ContentMismatch,
  EntryNotObserved,
  ExecutableMismatch,
  KindMismatch,
  ModeRefused,
  ObservedAbsent,
  ObservedLink,
  ObservedOther,
  ObservedRegular,
  ObservedUnreadable,
  ReviewCurrent,
  ReviewStale,
  SnapshotConsistent,
  SnapshotInconsistent,
} from "../../src/domain/snapshot.ts"
import { judgeSnapshot, reviewCurrent } from "../../src/features/snapshot.ts"

const blobA = "a".repeat(40)
const blobB = "b".repeat(40)

const entry = (path: string, mode: string, object = blobA, type: TreeEntryType = TreeEntryTypes.Blob): TreeEntry => ({
  mode,
  type,
  object: Revision.make(object),
  path,
})

const regular = (path: string, executable = false, blob = blobA) => new ObservedRegular({ path, executable, blob })
const link = (path: string, blob = blobA) => new ObservedLink({ path, blob })

const consistent = new SnapshotConsistent()

describe("judgeSnapshot", () => {
  it("accepts a regular file whose bytes have the entry's blob id", () => {
    expect(judgeSnapshot([entry("a.txt", "100644")], [regular("a.txt")])).toEqual(consistent)
  })

  it("accepts an executable file under mode 100755", () => {
    expect(judgeSnapshot([entry("run.sh", "100755")], [regular("run.sh", true)])).toEqual(consistent)
  })

  it("accepts a symbolic link whose link text has the entry's blob id", () => {
    expect(judgeSnapshot([entry("l", "120000")], [link("l")])).toEqual(consistent)
  })

  it("accepts an empty tree", () => {
    expect(judgeSnapshot([], [])).toEqual(consistent)
  })

  it("refuses a regular file whose blob id differs", () => {
    const tree = entry("a.txt", "100644")
    expect(judgeSnapshot([tree], [regular("a.txt", false, blobB)])).toEqual(
      new SnapshotInconsistent({ mismatches: [new ContentMismatch({ entry: tree, blob: blobB })] }),
    )
  })

  it("refuses an executable bit that differs, in either direction", () => {
    const plain = entry("a", "100644")
    const executable = entry("b", "100755")
    expect(judgeSnapshot([plain, executable], [regular("a", true), regular("b", false)])).toEqual(
      new SnapshotInconsistent({
        mismatches: [
          new ExecutableMismatch({ entry: plain, executable: true }),
          new ExecutableMismatch({ entry: executable, executable: false }),
        ],
      }),
    )
  })

  it("refuses a link whose link text has another blob id", () => {
    const tree = entry("l", "120000")
    expect(judgeSnapshot([tree], [link("l", blobB)])).toEqual(
      new SnapshotInconsistent({ mismatches: [new ContentMismatch({ entry: tree, blob: blobB })] }),
    )
  })

  it("refuses a link where the tree has a file, and a file where it has a link", () => {
    const file = entry("f", "100644")
    const symbolic = entry("l", "120000")
    const found = [link("f"), regular("l")]
    expect(judgeSnapshot([file, symbolic], found)).toEqual(
      new SnapshotInconsistent({
        mismatches: [new KindMismatch({ entry: file, found: link("f") }), new KindMismatch({ entry: symbolic, found: regular("l") })],
      }),
    )
  })

  it("refuses another kind on disk, nothing on disk and an unreadable path", () => {
    const directory = entry("d", "100644")
    const gone = entry("gone", "100644")
    const locked = entry("locked", "120000")
    const other = new ObservedOther({ path: "d" })
    const absent = new ObservedAbsent({ path: "gone" })
    const unreadable = new ObservedUnreadable({ path: "locked", reason: "EACCES" })
    expect(judgeSnapshot([directory, gone, locked], [other, absent, unreadable])).toEqual(
      new SnapshotInconsistent({
        mismatches: [
          new KindMismatch({ entry: directory, found: other }),
          new KindMismatch({ entry: gone, found: absent }),
          new KindMismatch({ entry: locked, found: unreadable }),
        ],
      }),
    )
  })

  it("refuses a gitlink and any other mode whatever is on disk", () => {
    const gitlink = entry("sub", "160000", blobA, TreeEntryTypes.Commit)
    const odd = entry("odd", "100664")
    const found = [new ObservedOther({ path: "sub" }), regular("odd")]
    expect(judgeSnapshot([gitlink, odd], found)).toEqual(
      new SnapshotInconsistent({ mismatches: [new ModeRefused({ entry: gitlink }), new ModeRefused({ entry: odd })] }),
    )
  })

  it("refuses a regular mode whose type is not a blob", () => {
    const tree = entry("t", "100644", blobA, TreeEntryTypes.Commit)
    expect(judgeSnapshot([tree], [regular("t")])).toEqual(
      new SnapshotInconsistent({ mismatches: [new ModeRefused({ entry: tree })] }),
    )
  })

  it("refuses an entry nothing was observed for", () => {
    const tree = entry("a", "100644")
    expect(judgeSnapshot([tree], [regular("other")])).toEqual(
      new SnapshotInconsistent({ mismatches: [new EntryNotObserved({ entry: tree })] }),
    )
  })

  it("lists every mismatch in tree order, keeping the matching entries out", () => {
    const changed = entry("b", "100644")
    const replaced = entry("d", "120000")
    const entries = [entry("a", "100644"), changed, entry("c", "100755"), replaced]
    const found = [regular("d", false, blobB), regular("c", true), regular("b", false, blobB), regular("a")]
    expect(judgeSnapshot(entries, found)).toEqual(
      new SnapshotInconsistent({
        mismatches: [
          new ContentMismatch({ entry: changed, blob: blobB }),
          new KindMismatch({ entry: replaced, found: regular("d", false, blobB) }),
        ],
      }),
    )
  })

  it("reports both an executable bit and a content mismatch on one file", () => {
    const tree = entry("a", "100644")
    expect(judgeSnapshot([tree], [regular("a", true, blobB)])).toEqual(
      new SnapshotInconsistent({
        mismatches: [new ExecutableMismatch({ entry: tree, executable: true }), new ContentMismatch({ entry: tree, blob: blobB })],
      }),
    )
  })
})

describe("reviewCurrent", () => {
  const reviewed = Revision.make(blobA)

  it("holds when the fresh snapshot is the reviewed tree", () => {
    expect(reviewCurrent(reviewed, Revision.make(blobA))).toEqual(new ReviewCurrent({ tree: reviewed }))
  })

  it("is stale when the fresh snapshot is another tree", () => {
    const current = Revision.make(blobB)
    expect(reviewCurrent(reviewed, current)).toEqual(new ReviewStale({ reviewed, current }))
  })
})
