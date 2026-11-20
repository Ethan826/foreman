// The target binding file on disk (batch review B04): read when present,
// and created once, exclusively. Creation writes the bytes to a temporary
// file of its own, flushes them, and links it to the final name with
// link(2), which fails when the name exists; so the final name holds a
// complete file or nothing, and two first uses cannot both win. The
// temporary file is then removed and the directory flushed. An existing
// binding is never replaced.
import { Effect, Option, Predicate } from "effect"
import { closeSync, fsyncSync, linkSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs"
import { dirname } from "node:path"
import { StateFileFailed } from "./state-files.ts"

/** The reason recorded when a thrown value carries no message. */
const unknownReason = "unknown error"

/** The file's bytes, or none when nothing is at `path`; fails on any other read error. */
export const readIfPresent = (path: string): Effect.Effect<Option.Option<Uint8Array>, StateFileFailed> =>
  Effect.catch(
    Effect.try({ try: () => Option.some(readFileSync(path)), catch: (cause) => cause }),
    (cause) => (hasCode(cause, "ENOENT") ? Effect.succeed(Option.none()) : Effect.fail(failed(path, cause))),
  )

/**
 * Creates `path` holding `bytes` unless something is already there, and
 * returns whether it did. `temporary` is a fresh name in the same
 * directory, which the caller makes unique.
 */
export const createExclusive = (
  path: string,
  temporary: string,
  bytes: Uint8Array,
): Effect.Effect<boolean, StateFileFailed> =>
  Effect.ensuring(
    Effect.gen(function* () {
      yield* writeFlushed(path, temporary, bytes)
      const created = yield* linked(temporary, path)
      yield* flushed(path, dirname(path), (descriptor) =>
        attempt(path, () => {
          fsyncSync(descriptor)
        }),
      )
      return created
    }),
    Effect.ignore(
      attempt(temporary, () => {
        unlinkSync(temporary)
      }),
      { log: true },
    ),
  )

/** Links `temporary` to `path`: true when linked, false when `path` already existed. */
const linked = (temporary: string, path: string) =>
  Effect.catch(
    Effect.try({
      try: () => {
        linkSync(temporary, path)
        return true
      },
      catch: (cause) => cause,
    }),
    (cause) => (hasCode(cause, "EEXIST") ? Effect.succeed(false) : Effect.fail(failed(path, cause))),
  )

/** Writes every byte to a new file at `temporary` and flushes it; failures are reported for `path`. */
const writeFlushed = (path: string, temporary: string, bytes: Uint8Array) =>
  Effect.acquireUseRelease(
    attempt(path, () => openSync(temporary, "w")),
    (descriptor) =>
      attempt(path, () => {
        writeAll(descriptor, bytes, 0)
        fsyncSync(descriptor)
      }),
    closed(path),
  )

/** Opens `target` for reading, runs `use` on it, and closes it on every path. */
const flushed = <A>(path: string, target: string, use: (descriptor: number) => Effect.Effect<A, StateFileFailed>) =>
  Effect.acquireUseRelease(attempt(path, () => openSync(target, "r")), use, closed(path))

/** Closes a descriptor; a failure to close is logged and ignored, since the data is already flushed. */
const closed = (path: string) => (descriptor: number) =>
  Effect.ignore(
    attempt(path, () => {
      closeSync(descriptor)
    }),
    { log: true },
  )

/** Writes `bytes` from `offset` to the end, repeating while a write is short. */
const writeAll = (descriptor: number, bytes: Uint8Array, offset: number): number =>
  offset >= bytes.byteLength
    ? offset
    : writeAll(descriptor, bytes, offset + writeSync(descriptor, bytes, offset, bytes.byteLength - offset))

/** Runs a file call, turning what it throws into {@link StateFileFailed}. */
const attempt = <A>(path: string, call: () => A) => Effect.try({ try: call, catch: (cause) => failed(path, cause) })

/** Whether a thrown value carries the error code `code`. */
const hasCode = (cause: unknown, code: string): boolean => Predicate.hasProperty(cause, "code") && cause.code === code

/** A thrown value as the typed failure for `path`. */
const failed = (path: string, cause: unknown) =>
  new StateFileFailed({
    path,
    reason: Predicate.hasProperty(cause, "message") && Predicate.isString(cause.message) ? cause.message : unknownReason,
  })
