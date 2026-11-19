import { describe, expect, it } from "@effect/vitest"
import { Option, Result } from "effect"
import type { AttributeReading, AttributeRefusal, FileReading, GitResult, TreeEntry, TreeReading } from "../../src/domain/attributes.ts"
import {
  AttributeRefusalReasons,
  AttributeSources,
  AttributeSourcesRefused,
  FileAbsent,
  FileFound,
  FileKinds,
  FileUnreadable,
  TreeListed,
  TreeNotListed,
  TreeEntryTypes,
  TreeUndecodable,
} from "../../src/domain/attributes.ts"
import { Revision } from "../../src/domain/ids.ts"
import { checkAttributeSources, isAttributesEntry, isRegularBlob } from "../../src/features/attribute-sources.ts"

const revision = Revision.make("a".repeat(40))
const object = Revision.make("b".repeat(40))
const infoPath = "/repo/.git/info/attributes"

const entry = (path: string, mode = "100644", type: TreeEntry["type"] = TreeEntryTypes.Blob): TreeEntry => ({ mode, type, object, path })

const exited = (exitCode: number, stdout = "", stderr = ""): GitResult => ({ exitCode, stdout, stderr })

/** A `.gitattributes` blob at `path` whose `cat-file` printed `content`. */
const blobFile = (path: string, content: string) => ({ entry: entry(path), blob: Option.some(exited(0, content)) })

const unset = exited(1)

const reading = (parts: {
  readonly tree?: TreeReading
  readonly info?: FileReading
  readonly attributesFile?: GitResult
  readonly conditionalIncludes?: GitResult
}): AttributeReading => ({
  revision,
  tree: parts.tree ?? new TreeListed({ files: [] }),
  infoAttributes: { path: infoPath, reading: parts.info ?? new FileAbsent() },
  attributesFile: parts.attributesFile ?? unset,
  conditionalIncludes: parts.conditionalIncludes ?? unset,
})

const refusal = (
  source: AttributeRefusal["source"],
  reason: AttributeRefusal["reason"],
  path: Option.Option<string>,
  line: Option.Option<number>,
  detail: string,
): AttributeRefusal => ({ source, reason, path, line, detail })

const refused = (...refusals: [AttributeRefusal, ...Array<AttributeRefusal>]) =>
  Result.fail(new AttributeSourcesRefused({ revision, refusals }))

const treeContent = (path: string, line: number, detail: string) =>
  refusal(AttributeSources.Tree, AttributeRefusalReasons.Content, Option.some(path), Option.some(line), detail)

describe("isAttributesEntry", () => {
  it("selects entries whose last path component is .gitattributes, at any depth", () => {
    expect(isAttributesEntry(entry(".gitattributes"))).toBe(true)
    expect(isAttributesEntry(entry("a/b/.gitattributes"))).toBe(true)
    expect(isAttributesEntry(entry("a/.gitattributes/b"))).toBe(false)
    expect(isAttributesEntry(entry("x.gitattributes"))).toBe(false)
    expect(isAttributesEntry(entry(".gitattributes.bak"))).toBe(false)
  })
})

describe("isRegularBlob", () => {
  it("holds for blobs of mode 100644 and 100755 only", () => {
    expect(isRegularBlob(entry("a"))).toBe(true)
    expect(isRegularBlob(entry("a", "100755"))).toBe(true)
    expect(isRegularBlob(entry("a", "120000"))).toBe(false)
    expect(isRegularBlob(entry("a", "040000", TreeEntryTypes.Tree))).toBe(false)
    expect(isRegularBlob(entry("a", "160000", TreeEntryTypes.Commit))).toBe(false)
  })
})

describe("checkAttributeSources", () => {
  it("passes with no attribute source", () => {
    expect(checkAttributeSources(reading({}))).toEqual(Result.succeed(revision))
  })

  it("passes .gitattributes holding only comments and blank lines, with LF or CRLF endings", () => {
    const files = [
      blobFile(".gitattributes", "# a comment\n\n   \n\t\n#* filter=x\n"),
      blobFile("sub/.gitattributes", "# a comment\r\n\r\n \t\r\n"),
      blobFile("empty/.gitattributes", ""),
    ]
    expect(checkAttributeSources(reading({ tree: new TreeListed({ files }) }))).toEqual(Result.succeed(revision))
  })

  it("passes an empty info/attributes", () => {
    const info = new FileFound({ kind: FileKinds.File, content: "" })
    expect(checkAttributeSources(reading({ info }))).toEqual(Result.succeed(revision))
  })

  it("refuses every line that is not blank or a comment, with its path and line number", () => {
    const files = [blobFile(".gitattributes", "# ok\nfuture/*.bin filter=mark\n"), blobFile("a/.gitattributes", "a.txt text\na.txt !text\n")]
    expect(checkAttributeSources(reading({ tree: new TreeListed({ files }) }))).toEqual(
      refused(
        treeContent(".gitattributes", 2, "future/*.bin filter=mark"),
        treeContent("a/.gitattributes", 1, "a.txt text"),
        treeContent("a/.gitattributes", 2, "a.txt !text"),
      ),
    )
  })

  it("refuses a comment marker after leading whitespace, a CR before the end and a BOM", () => {
    const files = [blobFile(".gitattributes", " # indented\n\r* -text\n﻿# bom\n")]
    expect(checkAttributeSources(reading({ tree: new TreeListed({ files }) }))).toEqual(
      refused(
        treeContent(".gitattributes", 1, " # indented"),
        treeContent(".gitattributes", 2, "\r* -text"),
        treeContent(".gitattributes", 3, "﻿# bom"),
      ),
    )
  })

  it("refuses a .gitattributes entry that is not a regular blob, unread", () => {
    const files = [
      { entry: entry(".gitattributes", "120000"), blob: Option.none() },
      { entry: entry("a/.gitattributes", "040000", TreeEntryTypes.Tree), blob: Option.none() },
      { entry: entry("b/.gitattributes", "160000", TreeEntryTypes.Commit), blob: Option.none() },
    ]
    const notRegular = (path: string, detail: string) =>
      refusal(AttributeSources.Tree, AttributeRefusalReasons.NotRegular, Option.some(path), Option.none(), detail)
    expect(checkAttributeSources(reading({ tree: new TreeListed({ files }) }))).toEqual(
      refused(
        notRegular(".gitattributes", `120000 ${TreeEntryTypes.Blob}`),
        notRegular("a/.gitattributes", `040000 ${TreeEntryTypes.Tree}`),
        notRegular("b/.gitattributes", `160000 ${TreeEntryTypes.Commit}`),
      ),
    )
  })

  it("refuses a regular blob whose cat-file exited non-zero, or that was not read", () => {
    const files = [
      { entry: entry(".gitattributes"), blob: Option.some(exited(128, "", "fatal: bad object\n")) },
      { entry: entry("a/.gitattributes"), blob: Option.none() },
    ]
    const failed = (path: string, detail: string) =>
      refusal(AttributeSources.Tree, AttributeRefusalReasons.ReadFailed, Option.some(path), Option.none(), detail)
    expect(checkAttributeSources(reading({ tree: new TreeListed({ files }) }))).toEqual(
      refused(failed(".gitattributes", "exit 128: fatal: bad object\n"), failed("a/.gitattributes", "not read")),
    )
  })

  it("refuses a tree that was not listed or did not decode", () => {
    const failed = (detail: string) =>
      refusal(AttributeSources.Tree, AttributeRefusalReasons.ReadFailed, Option.none(), Option.none(), detail)
    expect(checkAttributeSources(reading({ tree: new TreeNotListed({ exitCode: 128, stderr: "fatal: x\n" }) }))).toEqual(
      refused(failed("exit 128: fatal: x\n")),
    )
    expect(checkAttributeSources(reading({ tree: new TreeUndecodable({ reason: "bad record" }) }))).toEqual(
      refused(failed("bad record")),
    )
  })

  it("refuses info/attributes with any content, of another kind, or unreadable", () => {
    const info = (detail: string, reason: AttributeRefusal["reason"]) =>
      refusal(AttributeSources.InfoAttributes, reason, Option.some(infoPath), Option.none(), detail)
    const cases: ReadonlyArray<readonly [FileReading, AttributeRefusal]> = [
      [new FileFound({ kind: FileKinds.File, content: "# only a comment\n" }), info("# only a comment\n", AttributeRefusalReasons.Content)],
      [new FileFound({ kind: FileKinds.File, content: "\n" }), info("\n", AttributeRefusalReasons.Content)],
      [new FileFound({ kind: FileKinds.Directory, content: "" }), info(FileKinds.Directory, AttributeRefusalReasons.NotRegular)],
      [new FileFound({ kind: FileKinds.SymbolicLink, content: "" }), info(FileKinds.SymbolicLink, AttributeRefusalReasons.NotRegular)],
      [new FileUnreadable({ reason: "EACCES" }), info("EACCES", AttributeRefusalReasons.ReadFailed)],
    ]
    cases.forEach(([found, expected]) => {
      expect(checkAttributeSources(reading({ info: found }))).toEqual(refused(expected))
    })
  })

  it("refuses a configured core.attributesFile, and any config exit other than 0 or 1", () => {
    const setting = (reason: AttributeRefusal["reason"], detail: string) =>
      refusal(AttributeSources.AttributesFile, reason, Option.none(), Option.none(), detail)
    expect(checkAttributeSources(reading({ attributesFile: exited(0, "/x/attributes\n") }))).toEqual(
      refused(setting(AttributeRefusalReasons.Configured, "/x/attributes\n")),
    )
    expect(checkAttributeSources(reading({ attributesFile: exited(128, "", "fatal: bad config\n") }))).toEqual(
      refused(setting(AttributeRefusalReasons.ReadFailed, "exit 128: fatal: bad config\n")),
    )
    expect(checkAttributeSources(reading({ attributesFile: exited(2) }))).toEqual(
      refused(setting(AttributeRefusalReasons.ReadFailed, "exit 2: ")),
    )
  })

  it("refuses any conditional include listed (exit 0), and any listing exit other than 0 or 1", () => {
    const listing = (reason: AttributeRefusal["reason"], detail: string) =>
      refusal(AttributeSources.ConditionalInclude, reason, Option.none(), Option.none(), detail)
    const listed = "includeif.onbranch:foreman/**.path /x/selected\n"
    expect(checkAttributeSources(reading({ conditionalIncludes: exited(0, listed) }))).toEqual(
      refused(listing(AttributeRefusalReasons.Configured, listed)),
    )
    expect(checkAttributeSources(reading({ conditionalIncludes: exited(128, "", "fatal: bad config\n") }))).toEqual(
      refused(listing(AttributeRefusalReasons.ReadFailed, "exit 128: fatal: bad config\n")),
    )
    expect(checkAttributeSources(reading({ conditionalIncludes: exited(2) }))).toEqual(
      refused(listing(AttributeRefusalReasons.ReadFailed, "exit 2: ")),
    )
  })

  it("lists every refusal in source order: tree, info/attributes, the setting, then conditional includes", () => {
    const tree = new TreeListed({ files: [blobFile(".gitattributes", "* -text\n")] })
    const info = new FileFound({ kind: FileKinds.File, content: "x" })
    const conditionalIncludes = exited(0, "includeif.gitdir:/z.path /w\n")
    const result = checkAttributeSources(reading({ tree, info, attributesFile: exited(0, "/y\n"), conditionalIncludes }))
    expect(Result.map(Result.flip(result), (failure) => failure.refusals.map((each) => each.source))).toEqual(
      Result.succeed([
        AttributeSources.Tree,
        AttributeSources.InfoAttributes,
        AttributeSources.AttributesFile,
        AttributeSources.ConditionalInclude,
      ]),
    )
  })
})
