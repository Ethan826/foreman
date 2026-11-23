// The handoff's git work (plan "Write protocol", step 2; "Snapshot
// identity and raw checks"; "Profiles, environment and briefs"): the
// HEAD read of `close --finished` (owner ruling of 2026-11-23), the
// attribute-source check again, the snapshot and the review's changed
// paths, each in the supervisor worktree with git pinned to the session's
// recorded identity (plan B11d). The snapshot also points
// `GIT_INDEX_FILE` at a fresh temporary index in the state directory.
import { Effect, Result } from "effect"
import type { AttributeAllowance } from "../domain/attributes.ts"
import type { Revision } from "../domain/ids.ts"
import type { RecordedGitIdentity } from "../domain/session.ts"
import { GitOutputUndecodable } from "../domain/worktree.ts"
import { decodeRevParseRevision } from "../format/rev-parse.ts"
import { pinnedGitWith, type RunGit, type StartGit } from "../runtime/git.ts"
import { snapshotArgs } from "../runtime/snapshot.ts"
import { readOwnerHeadWith, revParseArgs } from "../runtime/worktree.ts"
import { checkAttributeSourcesWith } from "./attribute-sources.ts"
import type { HandoffGit } from "./session-context.ts"
import { snapshotProgramWith } from "./snapshot.ts"

/**
 * The handoff's git work over the process call `start`, judging the root
 * `.gitattributes` under `allowance` (decision M09), for the empty `home`
 * every git command runs with and the state directory `stateDir` that
 * holds the snapshot's temporary index.
 */
export const handoffGitWith =
  (start: StartGit, allowance: AttributeAllowance) =>
  (home: string, stateDir: string) =>
  (identity: RecordedGitIdentity): HandoffGit => {
    const pinned = pinnedGitWith(start)(home)(identity)
    const site = { worktree: identity.path, stateDirectory: stateDir }
    return {
      readHead: () => headWith(pinned, identity.path),
      checkAttributes: (base: Revision) =>
        Effect.asVoid(
          checkAttributeSourcesWith(pinned, allowance)({ cwd: identity.path, commonDir: identity.commonDir }, base),
        ),
      snapshot: (base: Revision) => snapshotProgramWith(start)(home)(identity)(site, base),
      changedPaths: (base: Revision, tree: Revision) => pinned(identity.path, snapshotArgs.changedPaths(base, tree)),
    }
  }

/**
 * The HEAD revision of the worktree at `path`: `git rev-parse HEAD` run
 * with `run`, which production pins to the recorded identity (plan B11d),
 * then decoded. A git failure keeps its `GitCommandFailed`, and output
 * that is not one revision is `GitOutputUndecodable`; neither is a
 * judgment (owner ruling on B11c and R01). The startup check
 * (`checkedHead`) and `close --finished` read HEAD this way.
 */
export const headWith = (run: RunGit, path: string) =>
  Effect.flatMap(readOwnerHeadWith(run)(path), (text) =>
    Effect.fromResult(Result.mapError(decodeRevParseRevision(text), headUndecodable)),
  )

/** A HEAD read that does not decode as a revision, naming the command. */
const headUndecodable = (issue: { readonly message: string }) =>
  new GitOutputUndecodable({ args: revParseArgs.ownerHead, reason: issue.message })
