// Files the log records by path and SHA-256 (plan "Write protocol"): a
// record whose file is missing or whose hash no longer matches makes the
// session close-only. These reads check the hash before anything uses
// the file.
import { Effect } from "effect"
import { sha256Of, type StateFiles } from "../runtime/state-files.ts"
import { strictText } from "./client-output.ts"
import type { SessionContext } from "./session-context.ts"
import { RecordedFileChanged } from "./session-errors.ts"

/** What reading a recorded file needs: the state files' read. */
export interface RecordedFileReader {
  readonly capabilities: { readonly stateFiles: Pick<StateFiles, "read"> }
}

/** Whether the file at `path` reads with SHA-256 `sha256`; an unreadable file is not intact. */
export const fileIntact = (context: RecordedFileReader, path: string, sha256: string) =>
  Effect.match(context.capabilities.stateFiles.read(path), {
    onFailure: () => false,
    onSuccess: (bytes) => sha256Of(bytes) === sha256,
  })

/**
 * The recorded file at `path` as strict UTF-8 text. Fails with
 * {@link RecordedFileChanged} when it is missing or its hash is not
 * `sha256`, and with `FileNotUtf8` when its bytes are not UTF-8 (review
 * finding R04).
 */
export const recordedText = (context: SessionContext, path: string, sha256: string) =>
  Effect.gen(function* () {
    const bytes = yield* Effect.mapError(context.capabilities.stateFiles.read(path), () => new RecordedFileChanged({ path }))
    if (sha256Of(bytes) !== sha256) return yield* new RecordedFileChanged({ path })
    return yield* strictText(path, bytes)
  })
