// A store directory before its first write (dogfood-1 finding): the
// state directory before the target binding or the project log is
// written, and the ledger directory before the ledger is opened. The
// configured path is resolved first, as the layout check resolves it
// (layout.ts), so a symbolic link to a directory is followed and a
// dangling one fails with `LayoutRefused` (owner ruling, dogfood-2).
// Runtime reads what is at the resolved path; Features decides. When
// nothing is there and the parent exists, Runtime creates one directory
// with mode 0700 and reads again, and Features judges the creation and
// that reading, as git's HOME is prepared (git-home.ts). A command judges
// all its store directories before it creates any (owner finding F7,
// dogfood-2). An existing directory is used as it is. `status` never calls this: it creates
// nothing.
import { Effect, Option, Schema } from "effect"
import { UseStoreDirectory } from "../domain/store-directory.ts"
import {
  judgeCreatedStoreDirectory,
  judgeExistingStoreDirectory,
  judgeStoreDirectory,
} from "../features/store-directory.ts"
import { createStoreDirectory, readStoreDirectory } from "../runtime/store-directory.ts"
import { resolvedPath } from "./layout.ts"

/**
 * Makes sure the store directory at `path` exists and returns `path` as
 * given: {@link preparedStoreDirectories} for that one directory.
 */
export const preparedStoreDirectory = (path: string) => Effect.as(preparedStoreDirectories([path]), path)

/**
 * Makes sure every store directory in `paths` exists, judging them all
 * before it creates any (owner finding F7, dogfood-2). Each path is
 * resolved, read and judged in order. Only when every one passed is each
 * missing one created, in the same order, mode 0700. A directory whose
 * parent is an earlier one still to be created passes the judgment. An
 * existing directory is used unchanged. Fails with `LayoutRefused` when a
 * path cannot be resolved, with `StoreDirectoryParentMissing` when a
 * parent is missing too, and with `StoreDirectoryRefused` for a
 * non-directory, an unreadable path, a mode that could not be set or a
 * creation that left no directory. A refused judgment creates nothing.
 */
export const preparedStoreDirectories = (paths: ReadonlyArray<string>) =>
  Effect.flatMap(
    Effect.reduce(paths, (): ReadonlyArray<string> => [], judgedStoreDirectory),
    (creating) => Effect.forEach(creating, createdStoreDirectory, { discard: true }),
  )

/**
 * Judges the store directory at `path` after the ones before it:
 * `creating` holds the resolved paths still to be created, and the result
 * adds this one's when it is missing too.
 */
const judgedStoreDirectory = (creating: ReadonlyArray<string>, path: string) =>
  Effect.gen(function* () {
    const resolved = yield* resolvedPath(path)
    const reading = yield* readStoreDirectory(resolved)
    const action = yield* Effect.fromResult(judgeStoreDirectory(resolved, reading, creating))
    return Schema.is(UseStoreDirectory)(action) ? creating : [...creating, resolved]
  })

/** Creates the store directory at the resolved `path`, then judges the creation and the path again. */
const createdStoreDirectory = (path: string) =>
  Effect.gen(function* () {
    const created = yield* Effect.result(createStoreDirectory(path))
    yield* Effect.fromResult(judgeCreatedStoreDirectory(path, created, yield* readStoreDirectory(path)))
  })

/**
 * Checks the store directory at `path` before anything is read from it,
 * creating nothing: an entry at its resolved path that is not a directory
 * fails with `StoreDirectoryRefused`, which names that path (owner
 * finding F2, dogfood-2). A path that cannot be resolved, is missing or
 * cannot be read passes here, so the command fails later exactly as it
 * did before; a dangling link still ends in `LayoutRefused`.
 */
export const checkedStoreDirectory = (path: string) =>
  Effect.flatMap(
    Effect.option(resolvedPath(path)),
    Option.match({
      onNone: () => Effect.void,
      onSome: (resolved) =>
        Effect.flatMap(readStoreDirectory(resolved), (reading) =>
          Effect.fromResult(judgeExistingStoreDirectory(resolved, reading)),
        ),
    }),
  )
