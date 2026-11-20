// The root `.gitattributes` allowance (owner decision M09, option a): an
// exact line, supplied per target, passes in the revision's root
// `.gitattributes` and nowhere else. A line passes only when it equals an
// allowed line byte for byte after its terminator (`\n`, or `\r\n`) is
// removed; every other source is judged as before.
import { describe, expect, it } from "@effect/vitest"
import { Option, Result, Schema } from "effect"
import type { AttributeAllowance, AttributeReading, AttributeRefusal, FileReading } from "../../src/domain/attributes.ts"
import {
  AttributeAllowance as AllowanceSchema,
  AttributeRefusalReasons,
  AttributeSources,
  AttributeSourcesRefused,
  FileAbsent,
  FileFound,
  FileKinds,
  noAttributeAllowance,
  TreeEntryTypes,
  TreeListed,
} from "../../src/domain/attributes.ts"
import { Revision } from "../../src/domain/ids.ts"
import { checkAttributeSources } from "../../src/features/attribute-sources.ts"

const revision = Revision.make("a".repeat(40))
const object = Revision.make("b".repeat(40))
const infoPath = "/repo/.git/info/attributes"

/** Waxwing's one content line (its root `.gitattributes`, blob 097bbbb). */
const waxwingLine = "*.wxw linguist-language=Rust"

/** Waxwing's root `.gitattributes`, byte for byte. */
const waxwingFile =
  "# Approximate highlighting on GitHub until Waxwing has its own grammar\n" +
  "# (IDE001); Rust colours keywords, literals and numbers reasonably.\n" +
  `${waxwingLine}\n`

const allowWaxwing: AttributeAllowance = { rootLines: [waxwingLine] }

/** A reading whose tree holds `.gitattributes` blobs `files` (path, content) and no other source. */
const reading = (files: ReadonlyArray<readonly [string, string]>, info: FileReading = new FileAbsent()): AttributeReading => ({
  revision,
  tree: new TreeListed({
    files: files.map(([path, content]) => ({
      entry: { mode: "100644", type: TreeEntryTypes.Blob, object, path },
      blob: Option.some({ exitCode: 0, stdout: content, stderr: "" }),
    })),
  }),
  infoAttributes: { path: infoPath, reading: info },
  attributesFile: { exitCode: 1, stdout: "", stderr: "" },
  conditionalIncludes: { exitCode: 1, stdout: "", stderr: "" },
})

const content = (path: string, line: number, detail: string): AttributeRefusal => ({
  source: AttributeSources.Tree,
  reason: AttributeRefusalReasons.Content,
  path: Option.some(path),
  line: Option.some(line),
  detail,
})

const refused = (...refusals: [AttributeRefusal, ...Array<AttributeRefusal>]) =>
  Result.fail(new AttributeSourcesRefused({ revision, refusals }))

/** The root file `text` checked under Waxwing's allowance. */
const rootUnderWaxwing = (text: string) => checkAttributeSources(reading([[".gitattributes", text]]), allowWaxwing)

describe("the root .gitattributes allowance", () => {
  it("passes Waxwing's root file when its line is allowed", () => {
    expect(rootUnderWaxwing(waxwingFile)).toEqual(Result.succeed(revision))
  })

  it("refuses Waxwing's line when the allowance is empty", () => {
    expect(checkAttributeSources(reading([[".gitattributes", waxwingFile]]), noAttributeAllowance)).toEqual(
      refused(content(".gitattributes", 3, waxwingLine)),
    )
  })

  it("refuses an allowed line in a nested .gitattributes, while the root's passes", () => {
    const files = [[".gitattributes", waxwingFile], ["sub/.gitattributes", waxwingFile]] as const
    expect(checkAttributeSources(reading(files), allowWaxwing)).toEqual(
      refused(content("sub/.gitattributes", 3, waxwingLine)),
    )
  })

  it("refuses near misses: an extra token, extra spaces, another value, a trailing comment, a prefix", () => {
    const misses = [
      "*.wxw linguist-language=Rust filter=x",
      "*.wxw  linguist-language=Rust",
      " *.wxw linguist-language=Rust",
      "*.wxw linguist-language=Rust ",
      "*.wxw\tlinguist-language=Rust",
      "*.wxw linguist-language=Ruby",
      "*.wxw linguist-language=Rust # highlighting",
      "*.wxw linguist-language=Rus",
    ]
    misses.forEach((miss) => {
      expect(rootUnderWaxwing(`${waxwingLine}\n${miss}\n`)).toEqual(refused(content(".gitattributes", 2, miss)))
    })
  })

  it("refuses a second content line that is not allowed, and only that line", () => {
    expect(rootUnderWaxwing(`${waxwingFile}*.txt filter=mark\n`)).toEqual(
      refused(content(".gitattributes", 4, "*.txt filter=mark")),
    )
  })

  it("still passes comments and blank lines around the allowed line", () => {
    expect(rootUnderWaxwing(`\n# before\n \t\n${waxwingLine}\n\n# after\n`)).toEqual(Result.succeed(revision))
  })

  it("removes a CRLF terminator before comparing", () => {
    expect(rootUnderWaxwing(`# one\r\n${waxwingLine}\r\n\r\n`)).toEqual(Result.succeed(revision))
  })

  it("passes the allowed line as the last line with no terminator", () => {
    expect(rootUnderWaxwing(`# one\n${waxwingLine}`)).toEqual(Result.succeed(revision))
  })

  it("removes only the terminator: a second CR, or a CR with no LF after it, is refused", () => {
    expect(rootUnderWaxwing(`${waxwingLine}\r\r\n`)).toEqual(refused(content(".gitattributes", 1, `${waxwingLine}\r\r`)))
    expect(rootUnderWaxwing(`${waxwingLine}\r`)).toEqual(refused(content(".gitattributes", 1, `${waxwingLine}\r`)))
  })

  it("passes every allowed line, and refuses the others", () => {
    const allowance = { rootLines: [waxwingLine, "*.md linguist-documentation"] }
    const text = `*.md linguist-documentation\n${waxwingLine}\n*.md linguist-detectable\n`
    expect(checkAttributeSources(reading([[".gitattributes", text]]), allowance)).toEqual(
      refused(content(".gitattributes", 3, "*.md linguist-detectable")),
    )
  })

  it("does not apply to info/attributes", () => {
    const info = new FileFound({ kind: FileKinds.File, content: `${waxwingLine}\n` })
    expect(checkAttributeSources(reading([], info), allowWaxwing)).toEqual(
      refused({
        source: AttributeSources.InfoAttributes,
        reason: AttributeRefusalReasons.Content,
        path: Option.some(infoPath),
        line: Option.none(),
        detail: `${waxwingLine}\n`,
      }),
    )
  })
})

describe("AttributeAllowance", () => {
  it("the empty allowance allows no line", () => {
    expect(noAttributeAllowance).toEqual({ rootLines: [] })
  })

  it("decodes exact lines and refuses a line holding a line terminator character", () => {
    const decode = Schema.decodeUnknownOption(AllowanceSchema)
    expect(decode({ rootLines: [waxwingLine] })).toEqual(Option.some({ rootLines: [waxwingLine] }))
    expect(decode({ rootLines: [`${waxwingLine}\n`] })).toEqual(Option.none())
    expect(decode({ rootLines: [`${waxwingLine}\r`] })).toEqual(Option.none())
    expect(decode({ rootLines: [`a\nb`] })).toEqual(Option.none())
  })
})
