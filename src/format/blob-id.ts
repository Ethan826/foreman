// git's blob ids, computed in-process for the snapshot's raw checks (plan
// A2, "Snapshot identity and raw checks" and "Provenance"). git's object
// format (gitformat-loose): a blob's id is the SHA-1 of the header
// `blob <size>` and a NUL, followed by the raw bytes, printed as 40
// lowercase hexadecimal digits. A symbolic link's blob is its link text.
// The digest itself is injected: Runtime passes the platform's SHA-1, so
// this module holds only git's framing and the hex encoding. Checked
// against `git hash-object` in `test/format/blob-id.test.ts`.
import { Hex } from "effect/encoding"
import type { GitResult } from "../domain/attributes.ts"

/** The digest of the concatenation of `parts`, each string taken as UTF-8 bytes. */
export type Sha1 = (parts: ReadonlyArray<string | Uint8Array>) => Uint8Array

/** The object type word that begins a blob's header (gitformat-loose). */
const blobType = "blob"

/** The byte that ends an object header. */
const headerEnd = "\0"

/** What `git rev-parse --show-object-format` prints for a SHA-1 repository. */
const sha1Format = "sha1\n"

/** The exit code of a `git rev-parse` that answered. */
const successExit = 0

/**
 * git's id of a blob holding exactly `bytes`: the hex SHA-1 of `blob
 * <size>\0<bytes>`, where size is the byte count in decimal. No
 * conversion is applied, so the id is that of the bytes as they are,
 * which is what a raw check compares with the tree's entry.
 */
export const blobId =
  (sha1: Sha1) =>
  (bytes: Uint8Array): string =>
    Hex.encode(sha1([header(bytes.byteLength), bytes]))

/**
 * Whether a `git rev-parse --show-object-format` run shows a SHA-1
 * repository: exit 0 and exactly `sha1` on one line. Anything else,
 * including SHA-256, is refused, since {@link blobId} computes SHA-1 ids
 * only (plan A2).
 */
export const isSha1ObjectFormat = (run: GitResult): boolean =>
  run.exitCode === successExit && run.stdout === sha1Format

/** A blob's object header for `size` bytes. */
const header = (size: number): string => `${blobType} ${size.toString()}${headerEnd}`
