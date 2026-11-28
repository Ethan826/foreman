// git's blob id of raw bytes (plan A2, "Snapshot identity and raw checks"
// and "Provenance"): the SHA-1 of `blob <size>\0<bytes>`, git's object
// format. Each fixture's id is compared with `git hash-object
// --no-filters` on the same file, so no conversion stands between the
// bytes and git's answer. The binary fixture is a git bundle, whose pack
// data is compressed and so holds bytes that are not UTF-8; it alone needs
// a repository, to bundle. The text fixtures run `hash-object` without
// `-w` in an empty temporary directory.
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { blobId, isSha1ObjectFormat } from "../../src/format/blob-id.ts"
import { sha1 } from "../../src/runtime/snapshot.ts"
import { git, repositoryMillis, withRepo } from "../runtime/git-repo.ts"

/**
 * The id computed in-process from the file's bytes, and git's id for the
 * same file, from `git hash-object` run in `cwd`. Without `-w` it writes
 * no object, so `cwd` need not be in a repository.
 */
const bothIds = (cwd: string, path: string) =>
  Effect.gen(function* () {
    const computed = blobId(sha1)(readFileSync(path))
    const fromGit = yield* git(cwd, "hash-object", "--no-filters", "--", path)
    return { computed, fromGit }
  })

/**
 * Runs `use` with a fresh, empty temporary directory, no repository, and
 * removes it afterwards.
 */
const withDir = <A, E>(use: (dir: string) => Effect.Effect<A, E>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => mkdtempSync(`${tmpdir()}/tarlatan-blob-`)),
    use,
    (dir) =>
      Effect.sync(() => {
        rmSync(dir, { recursive: true, force: true })
      }),
  )

/**
 * Writes `text` at `<dir>/<name>` in a temporary directory with no
 * repository and compares the two ids: the text comparisons need only
 * `hash-object`, one git start (dogfood-6f, finding F4).
 */
const textFixture = (name: string, text: string) => () =>
  withDir((dir) =>
    Effect.gen(function* () {
      writeFileSync(`${dir}/${name}`, text)
      const { computed, fromGit } = yield* bothIds(dir, `${dir}/${name}`)
      expect(computed).toBe(fromGit)
    }),
  )

/** Whether a byte is outside ASCII, so a lone one is not UTF-8. */
const isHighByte = (byte: number) => byte >= 0x80

/** A git bundle of `main` holds a NUL and high bytes; compares the two ids on it. */
const bundleFixture = (dir: string, owner: string) =>
  Effect.gen(function* () {
    yield* git(owner, "bundle", "create", "--quiet", `${dir}/fixture.bundle`, "main")
    const bytes = readFileSync(`${dir}/fixture.bundle`)
    expect(bytes.includes(0)).toBe(true)
    expect(bytes.some(isHighByte)).toBe(true)
    const { computed, fromGit } = yield* bothIds(owner, `${dir}/fixture.bundle`)
    expect(computed).toBe(fromGit)
  })

describe("blobId", () => {
  it("gives git's well-known id of the empty blob", () => {
    expect(blobId(sha1)(new Uint8Array(0))).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391")
  })

  it("gives git's id of the bytes of hello and a newline", () => {
    expect(blobId(sha1)(Uint8Array.from([104, 101, 108, 108, 111, 10]))).toBe(
      "ce013625030ba8dba906f756967f9e9ca394464a",
    )
  })

  it.effect("equals git hash-object on an empty file", textFixture("empty", ""), repositoryMillis)
  it.effect("equals git hash-object on a text file", textFixture("text", "one\ntwo\n"), repositoryMillis)
  it.effect("equals git hash-object on a file with CRLF line ends", textFixture("crlf", "one\r\ntwo\r\n"), repositoryMillis)
  it.effect("equals git hash-object on multibyte text", textFixture("utf8", "café ✓\n"), repositoryMillis)

  it.effect("equals git hash-object on a binary file that is not UTF-8", () => withRepo(bundleFixture), repositoryMillis)
})

describe("isSha1ObjectFormat", () => {
  const run = (exitCode: number, stdout: string) => ({ exitCode, stdout, stderr: "" })

  it("accepts rev-parse --show-object-format printing sha1", () => {
    expect(isSha1ObjectFormat(run(0, "sha1\n"))).toBe(true)
  })

  it("refuses sha256, empty output, other text and a non-zero exit", () => {
    expect(isSha1ObjectFormat(run(0, "sha256\n"))).toBe(false)
    expect(isSha1ObjectFormat(run(0, ""))).toBe(false)
    expect(isSha1ObjectFormat(run(0, "sha1\nsha1\n"))).toBe(false)
    expect(isSha1ObjectFormat(run(128, "sha1\n"))).toBe(false)
  })
})
