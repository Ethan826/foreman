// git's output is decoded strictly (review finding B17). A path or a
// blob holding bytes that are not UTF-8 must not decode to U+FFFD, where
// it would collide with a genuine U+FFFD path and pass every later path
// or content check. These cases run real git over objects written with
// `hash-object --literally`, because the file system refuses such names.
import { describe, expect, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { writeFileSync } from "node:fs"
import { noAttributeAllowance } from "../../src/domain/attributes.ts"
import { Revision } from "../../src/domain/ids.ts"
import { GitCommandFailed } from "../../src/domain/worktree.ts"
import { checkAttributeSourcesWith } from "../../src/program/attribute-sources.ts"
import { cleanGitOverrides, cleanGitWith, startGit, undecodableOutput } from "../../src/runtime/git.ts"
import { cleanRun, emptyHome, git, withRepo } from "./git-repo.ts"

/** git's id of the empty blob. */
const emptyBlob = "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391"

/** A byte that never occurs in UTF-8. */
const invalidByte = 0xff

/** U+FFFD, the replacement character, as its three UTF-8 bytes. */
const replacementBytes = [0xef, 0xbf, 0xbd]

/** The UTF-8 byte order mark. */
const byteOrderMark = [0xef, 0xbb, 0xbf]

/** The bytes of ASCII text. */
const ascii = (text: string) => Array.from(text, (character) => character.charCodeAt(0))

/** The bytes of a hexadecimal object id. */
const idBytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16))

/** One raw tree record: `100644 <name>\0<20-byte id>`, the name given as bytes. */
const treeRecord = (name: ReadonlyArray<number>) => [
  ...ascii("100644 "),
  ...name,
  0,
  ...idBytes(emptyBlob),
]

/** Writes `bytes` as an object of `type` in the repository at `repo` and returns its id. */
const writeObject = (repo: string, type: string, bytes: ReadonlyArray<number>) =>
  Effect.gen(function* () {
    writeFileSync(`${repo}/object.raw`, Uint8Array.from(bytes))
    return yield* git(repo, "hash-object", "-t", type, "-w", "--literally", "object.raw")
  })

/** Writes a tree whose entries are the empty blob under each name, names in byte order. */
const writeTree = (repo: string, names: ReadonlyArray<ReadonlyArray<number>>) =>
  Effect.gen(function* () {
    writeFileSync(`${repo}/empty.raw`, "")
    yield* git(repo, "hash-object", "-w", "empty.raw")
    return yield* writeObject(repo, "tree", names.flatMap(treeRecord))
  })

/** The clean runner over the real process call. */
const run = cleanGitWith(startGit)(emptyHome)

/** The failure of one run in `repo`; the test fails if it succeeds. */
const refusalOf = (repo: string, args: ReadonlyArray<string>) => Effect.flip(run(repo, args))

/** The failure for a run of `args` that exited 0 but printed bytes that are not UTF-8. */
const undecodable = (args: ReadonlyArray<string>) =>
  new GitCommandFailed({ args: [...cleanGitOverrides, ...args], exitCode: Option.some(0), stderr: undecodableOutput })

/** Asserts that the failure is the undecodable-output one for `args`, keeping git's exit code. */
const expectUndecodable = (refused: unknown, args: ReadonlyArray<string>) => {
  expect(refused).toEqual(undecodable(args))
}

/** An invalid name beside a genuine U+FFFD name: the listing is refused. */
const mixedListingRefused = (_dir: string, repo: string) =>
  Effect.gen(function* () {
    const tree = yield* writeTree(repo, [replacementBytes, [invalidByte]])
    const args = ["ls-tree", "-z", tree]
    expectUndecodable(yield* refusalOf(repo, args), args)
  })

/** An invalid name alone: the listing is refused rather than read as U+FFFD. */
const invalidListingRefused = (_dir: string, repo: string) =>
  Effect.gen(function* () {
    const tree = yield* writeTree(repo, [[invalidByte]])
    const args = ["ls-tree", "-z", tree]
    expectUndecodable(yield* refusalOf(repo, args), args)
  })

/** A genuine U+FFFD name alone: listed exactly. */
const replacementListingKept = (_dir: string, repo: string) =>
  Effect.gen(function* () {
    const tree = yield* writeTree(repo, [replacementBytes])
    const output = yield* run(repo, ["ls-tree", "-z", tree])
    expect(output.stdout).toBe(`100644 blob ${emptyBlob}\t\uFFFD\0`)
  })

/** Attribute content with an invalid byte: refused. */
const invalidContentRefused = (_dir: string, repo: string) =>
  Effect.gen(function* () {
    const text = [...ascii("* text"), invalidByte, 0x0a]
    const blob = yield* writeObject(repo, "blob", text)
    const args = ["cat-file", "blob", blob]
    expectUndecodable(yield* refusalOf(repo, args), args)
  })

/** Attribute content with a genuine U+FFFD and a leading byte order mark: kept exactly. */
const replacementContentKept = (_dir: string, repo: string) =>
  Effect.gen(function* () {
    const text = [...byteOrderMark, ...ascii("* text "), ...replacementBytes, 0x0a]
    const blob = yield* writeObject(repo, "blob", text)
    const output = yield* run(repo, ["cat-file", "blob", blob])
    expect(output.stdout).toBe("\uFEFF* text \uFFFD\n")
  })

/**
 * A committed `.gitattributes` holding an invalid byte: the attribute
 * check stops at the undecodable `cat-file` run instead of judging text in
 * which that byte became U+FFFD.
 */
const attributeCheckStops = (_dir: string, repo: string) =>
  Effect.gen(function* () {
    writeFileSync(`${repo}/.gitattributes`, Uint8Array.from([...ascii("* text"), invalidByte, 0x0a]))
    yield* git(repo, "add", ".gitattributes")
    yield* git(repo, "commit", "--quiet", "-m", "attributes")
    const revision = Revision.make(yield* git(repo, "rev-parse", "HEAD"))
    const blob = yield* git(repo, "rev-parse", "HEAD:.gitattributes")
    const check = checkAttributeSourcesWith(cleanRun, noAttributeAllowance)
    const refused = yield* Effect.flip(check({ cwd: repo, commonDir: `${repo}/.git` }, revision))
    expectUndecodable(refused, ["cat-file", "blob", blob])
  })

describe("path names from git are not decoded lossily", () => {
  it.effect("refuses a listing where an invalid name sits beside a genuine U+FFFD name", () =>
    withRepo(mixedListingRefused))

  it.effect("refuses a listing whose only name is invalid, so it cannot pass as U+FFFD", () =>
    withRepo(invalidListingRefused))

  it.effect("keeps a genuine U+FFFD name exactly", () => withRepo(replacementListingKept))
})

describe("blob content from git is not decoded lossily", () => {
  it.effect("refuses attribute content holding an invalid byte", () => withRepo(invalidContentRefused))

  it.effect("keeps attribute content with a genuine U+FFFD and a leading byte order mark exactly", () =>
    withRepo(replacementContentKept))

  it.effect("stops the attribute check at a .gitattributes holding an invalid byte", () =>
    withRepo(attributeCheckStops))
})
