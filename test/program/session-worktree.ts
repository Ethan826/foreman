// The supervisor worktree a session test records: a made-up one, for
// tests that never run git, or a real one added from a disposable
// repository at `<dir>/owner`, whose base commit holds `greeting.txt`.
import { Effect } from "effect"
import { writeFileSync } from "node:fs"
import { WorktreeCreated } from "../../src/domain/events.ts"
import { Revision } from "../../src/domain/ids.ts"
import { addWorktreeWith } from "../../src/runtime/worktree.ts"
import { cleanRun, git, makeRepo } from "../runtime/git-repo.ts"

/** The HEAD a made-up worktree reports. */
export const madeUpHead = Revision.make("e".repeat(40))

/** The branch of the supervisor worktree. */
const branch = "tarlatan/t"

/** A recorded worktree and the revision its check reports as HEAD. */
export interface RecordedSetting {
  readonly worktree: WorktreeCreated
  readonly base: Revision
}

/** A made-up worktree under `dir`; nothing exists on disk. */
export const madeUpWorktree = (dir: string): RecordedSetting => ({
  worktree: new WorktreeCreated({
    path: `${dir}/worktree`,
    branch,
    gitDir: `${dir}/repo/.git/worktrees/worktree`,
    commonDir: `${dir}/repo/.git`,
    base: madeUpHead,
  }),
  base: madeUpHead,
})

/** A real worktree at `<dir>/worktree`, added from `<dir>/owner` at a commit holding `greeting.txt`. */
export const realWorktree = (dir: string) =>
  Effect.gen(function* () {
    yield* makeRepo(dir, "owner")
    const owner = `${dir}/owner`
    writeFileSync(`${owner}/greeting.txt`, "Hello.\n")
    yield* git(owner, "add", "greeting.txt")
    yield* git(owner, "commit", "--quiet", "-m", "greeting")
    const base = Revision.make(yield* git(owner, "rev-parse", "HEAD"))
    const path = `${dir}/worktree`
    yield* addWorktreeWith(cleanRun)(owner, { branch, path, base })
    const worktree = new WorktreeCreated({
      path: yield* git(path, "rev-parse", "--show-toplevel"),
      branch,
      gitDir: yield* git(path, "rev-parse", "--absolute-git-dir"),
      commonDir: yield* git(path, "rev-parse", "--path-format=absolute", "--git-common-dir"),
      base,
    })
    return { worktree, base } satisfies RecordedSetting
  })
