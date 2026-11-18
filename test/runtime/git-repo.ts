// Test helper: a disposable git repository in a temporary directory, with
// user.name, user.email and commit.gpgsign set in the repository's own
// config (never the global one), and one commit on `main`. Git runs
// through the production `runGit`; a non-zero exit fails the test.
import { Effect } from "effect"
import { chmodSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { runGit } from "../../src/runtime/worktree.ts"

/** Runs git in `cwd` and returns its trimmed stdout; a non-zero exit is a test failure. */
export const git = (cwd: string, ...args: ReadonlyArray<string>) =>
  Effect.flatMap(runGit(cwd, args), (output) =>
    output.exitCode === 0
      ? Effect.succeed(output.stdout.trim())
      : Effect.fail(`git ${args.join(" ")} exited ${String(output.exitCode)}: ${output.stderr}`),
  )

/** Makes a commit with no changes on the current branch. */
export const emptyCommit = (repo: string, message: string) =>
  git(repo, "commit", "--quiet", "--allow-empty", "-m", message)

const initRepo = (repo: string) =>
  Effect.gen(function* () {
    yield* git(repo, "config", "user.name", "Foreman Test")
    yield* git(repo, "config", "user.email", "test@example.invalid")
    yield* git(repo, "config", "commit.gpgsign", "false")
    yield* emptyCommit(repo, "first")
  })

/**
 * Runs `use` with a fresh temporary directory holding an initialized
 * repository at `<dir>/owner`, and removes the directory afterwards.
 */
export const withRepo = <A, E>(use: (dir: string, owner: string) => Effect.Effect<A, E>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => mkdtempSync(`${tmpdir()}/foreman-worktree-`)),
    (dir) =>
      Effect.andThen(
        Effect.andThen(git(dir, "init", "--quiet", "-b", "main", "owner"), initRepo(`${dir}/owner`)),
        use(dir, `${dir}/owner`),
      ),
    (dir) =>
      Effect.sync(() => {
        rmSync(dir, { recursive: true, force: true })
      }),
  )

/** No permission bits: the directory can be neither listed nor searched. */
const unsearchableMode = 0o000

/** Owner read, write and search; group and others read and search. */
const searchableMode = 0o755

/**
 * Runs `use` while `directory` is unsearchable (mode 000), and restores
 * mode 755 afterwards so the temporary directory can be removed.
 */
export const withUnsearchable = <A, E>(directory: string, use: Effect.Effect<A, E>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      chmodSync(directory, unsearchableMode)
    }),
    () => use,
    () =>
      Effect.sync(() => {
        chmodSync(directory, searchableMode)
      }),
  )
