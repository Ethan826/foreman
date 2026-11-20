// The snapshot preflight's decisions (review finding B08, M14). Before
// anything is staged, Program walks the covered worktree with `lstat`;
// these functions decide what each listed directory means. A gitlink in
// the base tree, a covered directory holding `.git` and a covered special
// file are refused, because `add -A` would stage the first two as
// gitlinks or skip files, and silently leaves the third out. Coverage is
// what `add -A` over the base revision covers: every base path and the
// directories above it, plus what git does not ignore. Git's listing of
// ignored directories only says where to ask git; a path is treated as
// ignored only when `git check-ignore` says so.
import { Array as Arr, HashSet, String } from "effect"
import { FileKinds, TreeEntryTypes, type TreeEntry } from "../domain/attributes.ts"
import {
  GitlinkInBase,
  NestedRepository,
  SpecialFile,
  WalkFound,
  WalkInto,
  type WalkedChild,
  type WalkStep,
} from "../domain/snapshot.ts"

/** Where the paths the preflight needs to know about stand. */
export interface Coverage {
  /** Every base path and every directory above one: covered whatever the ignore rules say. */
  readonly kept: HashSet.HashSet<string>
  /** The directories `ls-files --ignored --directory` printed, without their trailing slash. */
  readonly listedIgnored: HashSet.HashSet<string>
}

/** The worktree's top level, as the walk names it. */
export const rootDirectory = ""

/** The name of git's directory or file inside a repository's top level. */
const gitEntry = ".git"

/** The separator between a path's components. */
const separator = "/"

/** The slash that ends a directory in git's listing. */
const trailingSlash = /\/$/

/**
 * The coverage of a base tree (`ls-tree -r`) and the run of `ls-files
 * --others --ignored --exclude-standard --directory` over an empty index:
 * only its entries that end in a slash, the directories, are kept.
 */
export const coverageOf = (base: ReadonlyArray<TreeEntry>, ignoredListing: ReadonlyArray<string>): Coverage => ({
  kept: HashSet.fromIterable(Arr.flatMap(base, pathAndAncestors)),
  listedIgnored: HashSet.fromIterable(Arr.map(Arr.filter(ignoredListing, isDirectoryListing), withoutSlash)),
})

/** Every gitlink (mode 160000, a commit entry) of the base tree, in tree order. */
export const baseGitlinks = (base: ReadonlyArray<TreeEntry>): ReadonlyArray<GitlinkInBase> =>
  Arr.map(Arr.filter(base, isGitlink), gitlinkAt)

/** The `.` that names the worktree's top level in a finding. */
export const displayPath = (directory: string): string => (String.isEmpty(directory) ? "." : directory)

/**
 * The walk's steps for one listed directory (`directory` relative to the
 * worktree's top level, {@link rootDirectory} for the top level itself).
 * Below the top level, a `.git` entry of any kind makes the directory a
 * nested repository, and the walk goes no further. Otherwise each
 * subdirectory is walked, each special file is recorded, and regular
 * files and links need nothing. A step asks git first unless its path is
 * kept; a subdirectory not listed as ignored is walked without asking.
 */
export const walkSteps = (
  coverage: Coverage,
  directory: string,
  children: ReadonlyArray<WalkedChild>,
): ReadonlyArray<WalkStep> =>
  isNestedRepository(directory, children)
    ? [new WalkFound({ finding: new NestedRepository({ path: directory }), unlessIgnored: !isKept(coverage, directory) })]
    : Arr.flatMap(Arr.filter(children, isNotGitEntry), stepFor(coverage, directory))

/** One child's step: walk a directory, record a special file, or nothing. */
const stepFor =
  (coverage: Coverage, directory: string) =>
  (child: WalkedChild): ReadonlyArray<WalkStep> => {
    const path = String.isEmpty(directory) ? child.name : `${directory}${separator}${child.name}`
    if (child.kind === FileKinds.Directory) return [new WalkInto({ path, unlessIgnored: mayBeIgnored(coverage, path) })]
    return child.kind === FileKinds.Other
      ? [new WalkFound({ finding: new SpecialFile({ path }), unlessIgnored: !isKept(coverage, path) })]
      : []
  }

/** Whether a subdirectory must be checked with git: listed as ignored and not kept. */
const mayBeIgnored = (coverage: Coverage, path: string): boolean =>
  HashSet.has(coverage.listedIgnored, path) && !isKept(coverage, path)

/** Whether the path is a base path or a directory above one. */
const isKept = (coverage: Coverage, path: string): boolean => HashSet.has(coverage.kept, path)

/** Whether a directory below the top level holds a `.git` entry. */
const isNestedRepository = (directory: string, children: ReadonlyArray<WalkedChild>): boolean =>
  String.isNonEmpty(directory) && Arr.some(children, isGitEntryChild)

/** Whether the child is named `.git`. */
const isGitEntryChild = (child: WalkedChild): boolean => child.name === gitEntry

/** Whether the child is not named `.git`; at the top level that is the worktree's own. */
const isNotGitEntry = (child: WalkedChild): boolean => !isGitEntryChild(child)

/** A path and every directory above it: `a/b/c` gives `a`, `a/b` and `a/b/c`. */
const pathAndAncestors = (entry: TreeEntry): ReadonlyArray<string> =>
  Arr.map(String.split(entry.path, separator), prefixOf(String.split(entry.path, separator)))

/** The path made of the first `index + 1` components. */
const prefixOf =
  (components: ReadonlyArray<string>) =>
  (_component: string, index: number): string =>
    Arr.join(Arr.take(components, index + 1), separator)

/** Whether a listed path is a directory: it ends in a slash. */
const isDirectoryListing = (path: string): boolean => String.endsWith(separator)(path)

/** The path without its trailing slash. */
const withoutSlash = (path: string): string => String.replace(trailingSlash, "")(path)

/** Whether the base entry is a gitlink. */
const isGitlink = (entry: TreeEntry): boolean => entry.type === TreeEntryTypes.Commit

/** The finding for a base gitlink. */
const gitlinkAt = (entry: TreeEntry): GitlinkInBase => new GitlinkInBase({ path: entry.path })
