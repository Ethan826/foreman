// Test helper: a disposable git repository in a temporary directory, with
// user.name, user.email and commit.gpgsign set in the repository's own
// config, and one commit on `main`. Git runs through the production
// clean runner (`cleanGit`, plan B11b and review item R8), so a global
// config, hooks or an inherited GIT_DIR in the test process do not reach
// it; a non-zero exit fails the test.
import { afterAll } from "@effect/vitest"
import { Effect } from "effect"
import { chmodSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { cleanGit, type RunGit } from "../../src/runtime/git.ts"

/**
 * The empty directory that every clean git run in this test file uses as
 * HOME. Made once per test file and removed after its tests.
 */
export const emptyHome = mkdtempSync(`${tmpdir()}/foreman-home-`)

afterAll(() => {
  rmSync(emptyHome, { recursive: true, force: true })
})

/** The production clean runner over {@link emptyHome}. */
export const cleanRun: RunGit = cleanGit(emptyHome)

/** Runs git through `run` in `cwd` and returns its trimmed stdout; a non-zero exit is a test failure. */
export const gitWith =
  (run: RunGit) =>
  (cwd: string, ...args: ReadonlyArray<string>) =>
    Effect.flatMap(run(cwd, args), (output) =>
      output.exitCode === 0
        ? Effect.succeed(output.stdout.trim())
        : Effect.fail(`git ${args.join(" ")} exited ${String(output.exitCode)}: ${output.stderr}`),
    )

/** {@link gitWith} over the clean runner. */
export const git = gitWith(cleanRun)

/** Makes a commit with no changes on the current branch, through `run`. */
export const emptyCommitWith = (run: RunGit) => (repo: string, message: string) =>
  gitWith(run)(repo, "commit", "--quiet", "--allow-empty", "-m", message)

/** {@link emptyCommitWith} over the clean runner. */
export const emptyCommit = emptyCommitWith(cleanRun)

const initRepo = (repo: string) =>
  Effect.gen(function* () {
    yield* git(repo, "config", "user.name", "Foreman Test")
    yield* git(repo, "config", "user.email", "test@example.invalid")
    yield* git(repo, "config", "commit.gpgsign", "false")
    yield* emptyCommit(repo, "first")
  })

/** Makes an initialized repository with one commit at `<dir>/<name>`. */
export const makeRepo = (dir: string, name: string) =>
  Effect.andThen(git(dir, "init", "--quiet", "-b", "main", name), initRepo(`${dir}/${name}`))

/**
 * Runs `use` with a fresh temporary directory holding an initialized
 * repository at `<dir>/owner`, and removes the directory afterwards.
 */
export const withRepo = <A, E>(use: (dir: string, owner: string) => Effect.Effect<A, E>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => mkdtempSync(`${tmpdir()}/foreman-worktree-`)),
    (dir) => Effect.andThen(makeRepo(dir, "owner"), use(dir, `${dir}/owner`)),
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
