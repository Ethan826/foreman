// Test helper: a disposable git repository in a temporary directory, with
// user.name and user.email set in the repository's own config, and one
// commit on `main`. Git runs through the production clean runner
// (`cleanGit`, plan B11b and review item R8), so a global config, hooks
// or an inherited GIT_DIR in the test process do not reach it; a non-zero
// exit fails the test. That runner, like every production runner, passes
// `-c commit.gpgsign=false` on each command, the first commit included,
// so the repository's config does not repeat it (dogfood-6e, correction
// 2, finding F4); a test that needs a repository-local signing setting
// sets it itself (git-hazards.test.ts).
import { afterAll } from "@effect/vitest"
import { Effect } from "effect"
import { chmodSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { cleanGit, type RunGit } from "../../src/runtime/git.ts"

/**
 * The empty directory that every clean git run in this test file uses as
 * HOME. Made once per test file and removed after its tests.
 */
export const emptyHome = mkdtempSync(`${tmpdir()}/tarlatan-home-`)

afterAll(() => {
  rmSync(emptyHome, { recursive: true, force: true })
})

/**
 * The time budget, in milliseconds, of every test that makes a disposable
 * repository with these helpers (`withRepo`, `makeRepo`, `realWorktree`,
 * the snapshot setting) or runs real git through them, outside the
 * session and production harnesses, which have their own (dogfood-6e,
 * owner ruling of 2026-11-27). These tests claim nothing about speed;
 * vitest's 5,000 ms default asserts nothing about them, and under a load
 * average of 75 to 200 a git start took well over 100 ms. In
 * `test/format/blob-id.test.ts` only the binary bundle fixture makes a
 * repository (`withRepo`); its four text fixtures run one `git
 * hash-object` each in an empty temporary directory, with no repository
 * (dogfood-6f, finding F4).
 *
 * What it bounds, counted from the code: the longest test of this kind,
 * git-coverage's "the production entry points run git with the same
 * environment as the factory", makes 35 git starts and no `ps`: the
 * repository (4: `init`, two `config`, a commit), its probe (3: `add`,
 * `commit`, `config`), two worktree creations (11 each: two `rev-parse`,
 * the attribute check's `ls-tree` and two `config`, the branch probe,
 * `worktree add` and four identity `rev-parse`) and one identification
 * (6: the worktree listing, two identity `rev-parse` and the attribute
 * check's three). Idle duration: 1,138 ms, measured by the coordinator on
 * 2026-11-28 at a load average of about 3; at most 6,351 ms under load
 * averages of 39 to 145, and 7,747 ms for the slowest test of this kind
 * under that load (worktree-create).
 */
export const repositoryMillis = 30_000

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
    yield* git(repo, "config", "user.name", "Tarlatan Test")
    yield* git(repo, "config", "user.email", "test@example.invalid")
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
    Effect.sync(() => mkdtempSync(`${tmpdir()}/tarlatan-worktree-`)),
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
