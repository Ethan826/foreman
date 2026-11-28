// The attribute check's read failures, and the startup check's attribute
// condition (plan B11c, owner rulings 3 and 4 of 2026-11-19). A read that
// fails stops creation and is never a pass: an unreadable info/attributes,
// a `cat-file` that exits non-zero and a `git config` that exits other
// than 0 or 1. With nothing else refused it stops as unread rather than
// refused (owner ruling on B11c and R01, 2026-11-20). The last two are made by a process call that passes every other
// command to the real one, through `worktreeProgramWith`'s clean runner.
// The startup check runs against the recorded revision and reads no
// working tree's `.gitattributes`, as git under the clean environment
// does not.
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs"
import {
  AttributeRefusalReasons as Reasons,
  AttributeSources as Sources,
  FileKinds,
  noAttributeAllowance,
} from "../../src/domain/attributes.ts"
import { WorktreeCreated } from "../../src/domain/events.ts"
import { Revision } from "../../src/domain/ids.ts"
import { worktreeProgramWith } from "../../src/program/worktree.ts"
import { startGit, type StartGit } from "../../src/runtime/git.ts"
import { emptyHome, git, repositoryMillis, withRepo } from "../runtime/git-repo.ts"
import { createWorktree, identifyWorktree, request } from "./git-hazard-fixtures.ts"
import { commitAttributes, kinds, leftNothing, readFailuresOf, refusalsOf } from "./attribute-fixtures.ts"

/** The real process call, except that a command starting with `verb` exits `exitCode`. */
const exitingFor =
  (verb: string, exitCode: number): StartGit =>
  (invocation) =>
    invocation.args.includes(verb)
      ? Effect.succeed({ exitCode, stdout: "", stderr: `${verb} made to fail\n` })
      : startGit(invocation)

/** No permission bits: the file cannot be read. */
const unreadableMode = 0o000

/** Owner read and write; group and others read. */
const readableMode = 0o644

const refusesUnreadableInfo = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const path = `${owner}/.git/info/attributes`
    writeFileSync(path, "")
    chmodSync(path, unreadableMode)
    const refusals = yield* Effect.ensuring(
      readFailuresOf(createWorktree(request(owner, dir))),
      Effect.sync(() => {
        chmodSync(path, readableMode)
      }),
    )
    expect(kinds(refusals)).toEqual([[Sources.InfoAttributes, Reasons.ReadFailed]])
    yield* leftNothing(dir, owner)
  })

const refusesInfoDirectory = (dir: string, owner: string) =>
  Effect.gen(function* () {
    mkdirSync(`${owner}/.git/info/attributes`)
    const refusals = yield* refusalsOf(createWorktree(request(owner, dir)))
    expect(kinds(refusals)).toEqual([[Sources.InfoAttributes, Reasons.NotRegular]])
    yield* leftNothing(dir, owner)
  })

const refusesInfoSymlink = (dir: string, owner: string) =>
  Effect.gen(function* () {
    writeFileSync(`${dir}/empty`, "")
    symlinkSync(`${dir}/empty`, `${owner}/.git/info/attributes`)
    const refusals = yield* refusalsOf(createWorktree(request(owner, dir)))
    expect(refusals.map((each) => [each.source, each.reason, each.detail])).toEqual([
      [Sources.InfoAttributes, Reasons.NotRegular, FileKinds.SymbolicLink],
    ])
    yield* leftNothing(dir, owner)
  })

/** Creation over a process call where `verb` exits `exitCode`, stopped as unread with `expected`. */
const refusedWhenExiting =
  (verb: string, exitCode: number, expected: ReadonlyArray<readonly [string, string, string]>) => () =>
    withRepo((dir, owner) =>
      Effect.gen(function* () {
        yield* commitAttributes(owner, ".gitattributes", "# only a comment\n")
        const program = worktreeProgramWith(exitingFor(verb, exitCode), noAttributeAllowance)(emptyHome)
        const failures = yield* readFailuresOf(program.createWorktree(request(owner, dir)))
        expect(failures.map((each) => [each.source, each.reason, each.detail])).toEqual(expected)
        yield* leftNothing(dir, owner)
      }),
    )

describe("a read failure stops creation as unread, and a source of another kind is refused", () => {
  it.effect("an unreadable info/attributes", () => withRepo(refusesUnreadableInfo), repositoryMillis)
  it.effect("an info/attributes that is a directory", () => withRepo(refusesInfoDirectory), repositoryMillis)
  it.effect("an info/attributes that is a symbolic link to an empty file", () =>
    withRepo(refusesInfoSymlink), repositoryMillis)
  it.effect(
    "a cat-file that exits non-zero",
    refusedWhenExiting("cat-file", 128, [[Sources.Tree, Reasons.ReadFailed, "exit 128: cat-file made to fail\n"]]),
    repositoryMillis,
  )
  it.effect(
    "a git config that exits 2",
    refusedWhenExiting("config", 2, [
      [Sources.AttributesFile, Reasons.ReadFailed, "exit 2: config made to fail\n"],
      [Sources.ConditionalInclude, Reasons.ReadFailed, "exit 2: config made to fail\n"],
    ]),
    repositoryMillis,
  )
  it.effect(
    "an ls-tree that exits non-zero",
    refusedWhenExiting("ls-tree", 128, [[Sources.Tree, Reasons.ReadFailed, "exit 128: ls-tree made to fail\n"]]),
    repositoryMillis,
  )
})

/** The recorded worktree with `base` in place of its own. */
const withBase = (created: WorktreeCreated, base: Revision) =>
  new WorktreeCreated({
    path: created.path,
    branch: created.branch,
    gitDir: created.gitDir,
    commonDir: created.commonDir,
    base,
  })

const refusesGainedAttributes = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const created = yield* createWorktree(request(owner, dir))
    yield* commitAttributes(created.path, ".gitattributes", "*.bin -diff\n")
    const base = Revision.make(yield* git(created.path, "rev-parse", "HEAD"))
    const refusals = yield* refusalsOf(identifyWorktree(withBase(created, base)))
    expect(refusals.map((each) => [each.source, each.reason, each.detail])).toEqual([
      [Sources.Tree, Reasons.Content, "*.bin -diff"],
    ])
  })

const refusesLaterInfo = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const created = yield* createWorktree(request(owner, dir))
    writeFileSync(`${created.commonDir}/info/attributes`, "* text\n")
    expect(kinds(yield* refusalsOf(identifyWorktree(created)))).toEqual([[Sources.InfoAttributes, Reasons.Content]])
  })

const refusesLaterSetting = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const created = yield* createWorktree(request(owner, dir))
    yield* git(owner, "config", "core.attributesFile", `${dir}/attributes`)
    expect(kinds(yield* refusalsOf(identifyWorktree(created)))).toEqual([[Sources.AttributesFile, Reasons.Configured]])
  })

const ignoresWorkingTrees = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const created = yield* createWorktree(request(owner, dir))
    writeFileSync(`${created.path}/.gitattributes`, "* filter=mark\n")
    writeFileSync(`${owner}/.gitattributes`, "* filter=mark\n")
    const entry = yield* identifyWorktree(created)
    expect(entry.path).toBe(created.path)
  })

describe("the startup check's attribute condition", () => {
  it.effect("refuses a recorded revision that gained a .gitattributes with content", () =>
    withRepo(refusesGainedAttributes), repositoryMillis)
  it.effect("refuses an info/attributes written after creation", () => withRepo(refusesLaterInfo), repositoryMillis)
  it.effect("refuses a core.attributesFile set after creation", () => withRepo(refusesLaterSetting), repositoryMillis)
  it.effect("does not read a working tree's uncommitted .gitattributes", () =>
    withRepo(ignoresWorkingTrees), repositoryMillis)
})
