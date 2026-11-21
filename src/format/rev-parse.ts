// Decoders for single-value `git rev-parse` output (git-rev-parse(1)):
// git prints the value and one newline. Exactly one trailing newline is
// removed and nothing else, so a path that itself ends in or contains a
// newline survives (owner's correction to ruling 4 on B11a). Each value is
// read by its own `rev-parse`, so no value is split from another at a
// newline.
import { Array as Arr, Option, Result, Schema, SchemaTransformation, String } from "effect"
import { Revision } from "../domain/ids.ts"
import { GitText, IdentityNoRepository, IdentityPrinted, type IdentityRun, IdentityUnread } from "../domain/worktree.ts"

/** The newline git prints after each value. */
const lineEnd = "\n"

/** The number of characters in {@link lineEnd}. */
const lineEndLength = 1

/** An absolute path: non-empty and starting with `/`. */
const AbsolutePath = GitText.check(Schema.isStartingWith("/"))

/** Removes the final newline, which the check in {@link lineOf} guarantees. */
const dropLineEnd = String.slice(0, -lineEndLength)

/** Adds the newline back, for the encoding direction. */
const addLineEnd = (value: string): string => `${value}${lineEnd}`

/** One output line: text ending in a newline, decoded to the text before it. */
const lineOf = <Value>(value: Schema.Codec<Value, string>) =>
  Schema.String.check(Schema.isEndingWith(lineEnd)).pipe(
    Schema.decodeTo(value, SchemaTransformation.transform({ decode: dropLineEnd, encode: addLineEnd })),
  )

const decodeLine = Schema.decodeUnknownResult(lineOf(GitText))
const decodePathLine = Schema.decodeUnknownResult(lineOf(AbsolutePath))
const decodeRevisionLine = Schema.decodeUnknownResult(lineOf(Revision))

/**
 * Decodes one value of `rev-parse`, such as `--symbolic-full-name HEAD`:
 * the text before the one trailing newline, which must be non-empty.
 * Fails when there is no trailing newline or nothing before it.
 */
export const decodeRevParseLine = (text: string): Result.Result<string, Schema.SchemaError> =>
  decodeLine(text)

/**
 * Decodes one absolute path from `rev-parse`, such as `--show-toplevel` or
 * `--absolute-git-dir`: as {@link decodeRevParseLine}, and the value must
 * start with `/`.
 */
export const decodeRevParsePath = (text: string): Result.Result<string, Schema.SchemaError> =>
  decodePathLine(text)

/**
 * Decodes `rev-parse HEAD` in the owner's checkout as a {@link Revision}
 * (owner ruling on R2 of the B11a review: Format decodes, not Runtime).
 * Fails when there is no trailing newline or the text before it is not
 * an object id.
 */
export const decodeRevParseRevision = (text: string): Result.Result<Revision, Schema.SchemaError> =>
  decodeRevisionLine(text)

/** The exit code of a `rev-parse` that printed its value. */
const successExit = 0

/**
 * How git's diagnostic begins when it finds no repository: discovery that
 * reached the root or a mount point, and a `.git` file naming a directory
 * that is not a repository (git's `setup.c`, checked against git 2.50.1).
 * git runs with no `LANG` or `LC_*` in the clean environment, so the
 * message is in the C locale, untranslated.
 */
const noRepositoryDiagnostic = "fatal: not a git repository"

/**
 * Decodes one identity `rev-parse` run, such as `--absolute-git-dir`
 * inside the recorded path (owner ruling on the R2 residue of the B11a
 * review; focused re-review finding 1). Exit 0 decodes its stdout as
 * {@link decodeRevParsePath} does, into `IdentityPrinted`. A non-zero exit
 * whose last stderr line begins with git's no-repository diagnostic is
 * `IdentityNoRepository`, whatever lines come before it, such as Apple
 * Git's warnings about its temporary directory (follow-up review at
 * 3b72efc, finding 1). Any other non-zero exit, such as an I/O error
 * reading the repository, is `IdentityUnread`. Both keep the exit code and
 * all of stderr. Fails only when a run that exited 0 printed something
 * other than one absolute path.
 */
export const decodeIdentityRun = (run: {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}): Result.Result<IdentityRun, Schema.SchemaError> =>
  run.exitCode === successExit
    ? Result.map(decodePathLine(run.stdout), (path) => new IdentityPrinted({ path }))
    : Result.succeed(exitedRun(run))

/** A non-zero identity run: git's report of no repository, or a read it could not complete. */
const exitedRun = (run: { readonly exitCode: number; readonly stderr: string }): IdentityRun =>
  Option.exists(lastLine(run.stderr), String.startsWith(noRepositoryDiagnostic))
    ? new IdentityNoRepository({ exitCode: run.exitCode, stderr: run.stderr })
    : new IdentityUnread({ exitCode: run.exitCode, stderr: run.stderr })

/**
 * The last line of git's stderr, without the one newline that ends it.
 * git stops at its fatal diagnostic, so that line is the last one; a
 * diagnostic followed by anything else, even an empty line, is not read
 * as one.
 */
const lastLine = (stderr: string): Option.Option<string> =>
  Arr.last(String.split(String.endsWith(lineEnd)(stderr) ? dropLineEnd(stderr) : stderr, lineEnd))
