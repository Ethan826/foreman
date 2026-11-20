// State files (plan "Injected capabilities"): the raw output, handoff and
// other files that events refer to by path and SHA-256. Publishing writes
// `<path>.tmp`, flushes it to storage, renames it over `path` and flushes
// the directory, so the final name holds either the earlier file or the
// complete new one, never a partial write (rename(2) replaces in one
// step within a file system). A stale `<path>.tmp` from an interrupted
// publish is overwritten. The hash is of the bytes given, which are the
// bytes written.
import { Effect, Predicate, Schema } from "effect"
import { createHash } from "node:crypto"
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, writeSync } from "node:fs"
import { dirname } from "node:path"

/** A state file could not be written, flushed, renamed or read. */
export class StateFileFailed extends Schema.TaggedError<StateFileFailed>()("StateFileFailed", {
  /** The final path being published or read. */
  path: Schema.String,
  reason: Schema.String,
}) {}

/**
 * Reads and publishes state files. Program receives {@link stateFiles};
 * a test may inject another.
 */
export interface StateFiles {
  /**
   * Publishes `bytes` atomically at `path` (see the module comment) and
   * returns their SHA-256 as 64 lower-case hexadecimal digits. On failure
   * the final name is left as it was, unless the failure came after the
   * rename, while flushing the directory.
   */
  readonly publish: (path: string, bytes: Uint8Array) => Effect.Effect<string, StateFileFailed>
  /** Reads the whole file at `path` as bytes. */
  readonly read: (path: string) => Effect.Effect<Uint8Array, StateFileFailed>
}

/** The suffix of the temporary file a publish writes before renaming it. */
export const temporarySuffix = ".tmp"

/** The reason recorded when a thrown value carries no message. */
const unknownReason = "unknown error"

/** The temporary path a publish of `path` writes: `<path>.tmp`. */
export const temporaryPathOf = (path: string): string => `${path}${temporarySuffix}`

/** The SHA-256 of `bytes` as lower-case hexadecimal. */
export const sha256Of = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex")

/** Writes, flushes and renames, then flushes the directory, then hashes. */
const publish = (path: string, bytes: Uint8Array): Effect.Effect<string, StateFileFailed> =>
  Effect.gen(function* () {
    const temporary = temporaryPathOf(path)
    yield* writeFlushed(path, temporary, bytes)
    yield* attempt(path, () => {
      renameSync(temporary, path)
    })
    yield* attempt(path, () => {
      flushDirectory(dirname(path))
    })
    return sha256Of(bytes)
  })

/** Reads the file at `path`. */
const read = (path: string): Effect.Effect<Uint8Array, StateFileFailed> => attempt(path, () => readFileSync(path))

/** The production state files over the local file system. */
export const stateFiles: StateFiles = { publish, read }

/**
 * Writes `bytes` to `temporary`, creating or truncating it, and flushes
 * them to storage. The descriptor is closed on every path; a failure to
 * close after the flush is logged and ignored, since the data is already
 * stored.
 */
const writeFlushed = (path: string, temporary: string, bytes: Uint8Array) =>
  Effect.acquireUseRelease(
    attempt(path, () => openSync(temporary, "w")),
    (descriptor) =>
      attempt(path, () => {
        writeAll(descriptor, bytes, 0)
        fsyncSync(descriptor)
      }),
    (descriptor) =>
      Effect.ignore(
        attempt(path, () => {
          closeSync(descriptor)
        }),
        { log: true },
      ),
  )

/**
 * Writes `bytes` from `offset` to the end, repeating while `writeSync`
 * writes fewer than asked, and returns the number of bytes in the file.
 * A self tail call, which Bun runs without growing the stack.
 */
const writeAll = (descriptor: number, bytes: Uint8Array, offset: number): number =>
  offset >= bytes.byteLength
    ? offset
    : writeAll(descriptor, bytes, offset + writeSync(descriptor, bytes, offset, bytes.byteLength - offset))

/** Flushes a directory's entries, so a rename inside it is stored. */
const flushDirectory = (directory: string): void => {
  const descriptor = openSync(directory, "r")
  fsyncSync(descriptor)
  closeSync(descriptor)
}

/** Runs a file call, turning what it throws into {@link StateFileFailed}. */
const attempt = <A>(path: string, call: () => A): Effect.Effect<A, StateFileFailed> =>
  Effect.try({ try: call, catch: (cause) => new StateFileFailed({ path, reason: reasonOf(cause) }) })

/** A thrown value's message. */
const reasonOf = (cause: unknown): string =>
  Predicate.hasProperty(cause, "message") && Predicate.isString(cause.message) ? cause.message : unknownReason
