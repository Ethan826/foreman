# Dogfood-8: snapshots kept by ref, and the restore

## Task

Slice 3 of v0.2.0, first half ([design](2026-11-25-session-recovery-and-rulings-design.md),
"Retry and back-up": "What is kept" and "The restore", the "Adversarial
review" section with its claims C1 to C4, C7 and restrictions;
[plan](2026-11-25-session-recovery-and-rulings-plan.md), tasks 3.1 and
3.3). Slices 1 and 2 are on `main` (ff8b86a). The second half,
dogfood-8b, adds the session line, `back-up` and `retry`, which use
what this task builds. No new command here. The fresh task review is
[beside this file](2026-11-28-dogfood-8-task-review.md); its findings
are folded in below.

1. Every attempt's start and end tree, and the tree a session opens on,
   are kept as commits on private refs, so `git gc` cannot prune them and
   a later back-up can restore them.
2. A restore procedure puts a kept tree back onto the supervisor
   worktree, or refuses touching nothing, or reports exactly what it
   could not restore. It is a pair of Program functions with their tests;
   nothing calls them yet.

### Owner rulings for this task (do not reopen)

1. The design is approved (2026-11-25) with its adversarial review; the
   restore's pre-checks and outcomes are as the design states, with the
   additions below.
2. **Event.** `SnapshotKept { sessionId, point, tree, ref, excludeDigest }`
   in `src/domain/session-events.ts`, joining `ProjectEvent`;
   `raisesLogFormat` returns true for it. `point` is a union of
   `Schema.TaggedClass` values `KeptAtOpen`, `KeptAtStart { opId }` and
   `KeptAtEnd { opId }` (no string vocabulary). `excludeDigest` is the
   SHA-256 of `.git/info/exclude` in the common git directory, or of the
   empty input when the file is absent. `SnapshotTaken` keeps its meaning
   and shape. `SnapshotKept` stays out of `OpenSession` (status reads it
   from the log's events), so no `OpenSession` literal changes.
3. **Where snapshots are taken, and what a failure does** (owner, 2026-11-28,
   review B3 and I2).
   - `session open` takes a snapshot of the worktree on its HEAD (the
     base to be) after its rules pass and before its batch, keeps it, and
     records `KeptAtOpen` in that batch. A refused snapshot, a refused
     attribute check or a failed ref write fails the command with a
     typed error before the batch: nothing is appended.
   - Every launch (implement, review, correct) keeps a start tree after
     `admitStep` and before batch I, and records `KeptAtStart` in batch
     I. For review and correct, the start tree is the step-2 snapshot
     the plan already takes (`review.ts:92`, `correct.ts:72`), not a
     second one; implement takes a new one the same way (`takeSnapshot`,
     `src/program/handoff-facts.ts:76`, with its attribute checks). A
     refused snapshot or attribute check, or a failed ref write, fails
     the command before batch I, leaving the grant an orphan for the next
     settle step, as a failed brief publication does
     (`attempt.ts:205-215`). For implement, a refused snapshot is a
     typed error the command returns, not a value a rule may ignore: the
     `Implement` rules do not change.
   - Every launch takes a fresh snapshot after the client exits and
     keeps it as the end tree. Batch F always appends `Finished` and
     `ReportRecorded` as today; `SnapshotKept(KeptAtEnd)` is added only
     when the snapshot, its attribute checks and the ref write all
     succeed. Otherwise the batch has no `KeptAtEnd`, the command
     returns its outcome as today, and status names the attempt as
     having no kept end tree. A finished client run is never left
     incomplete by a snapshot.
   - A review takes a fresh end snapshot too and records the tree it
     found. When it differs from the start tree, the difference shows in
     the log and status; this task adds no refusal for it.
   - Waivers (`isRefusal`, `src/program/waiver-expiry.ts`): a snapshot
     or attribute refusal at a start keeps today's classification (a
     refusal); a failed `commit-tree` or `update-ref` is a failure. Any
     new error tag joins `AttemptStop` and `isRefusal` with that rule.
4. **Batch order.**
   - open: `[SessionOpened, SnapshotKept(KeptAtOpen), Approved]`;
   - batch I: `[...consent, Intended, BriefRecorded, SnapshotKept(KeptAtStart), ...expiries]`;
   - batch F: `[Finished, ReportRecorded, ...extras, SnapshotKept(KeptAtEnd)]`.
5. **Refs** (git through `pinnedGitWith`/`snapshotGitWith` in
   `src/runtime/git.ts`; Runtime builds arguments and runs them, Format
   decodes their output, as `runtime/snapshot.ts` and `snapshotArgs` do).
   - For each kept tree: `git -c user.name=tarlatan -c
     user.email=tarlatan@invalid commit-tree <tree> -p <base>` with a
     message naming the session, the point and the opId, then
     `git update-ref <ref> <commit> <zero-oid>`, so the ref must not
     exist. The identity is fixed in the arguments (coordinator, review
     B1): production git reads no global config (`git.ts:79-85`), and a
     target's own config may have none. `<base>` is the session's
     `baseRevision`; at open, the HEAD the session opens on.
   - Names: `refs/tarlatan/<sessionId>/open`,
     `refs/tarlatan/<sessionId>/<opId>/start`, `.../<opId>/end`. The
     segments `open`, `start` and `end` are one Domain constant beside
     the `KeptAt*` classes, used by the writer and by orphan detection.
     Generated session and op ids cannot form an invalid ref name
     (`production.ts:169-173`); say so in the TSDoc, and refuse with a
     typed error any id that `git check-ref-format` would reject rather
     than writing it.
   - `session close --finished`, after its batch, deletes every ref under
     `refs/tarlatan/<sessionId>/` (kept and orphan) with `update-ref -d
     <ref> <oid>` each. The close stands once its batch is committed; a
     deletion that fails makes the command print
     `KeptRefsRemain { refs }` on stderr and exit 1, and status
     lists those refs under the closed session. The other closes keep
     their refs and still run no git (`ExitContext`, `session.ts:34-44`).
   - A Runtime function lists refs under a prefix
     (`for-each-ref --format=... refs/tarlatan/`), decoded in Format.
6. **Status** (owner, 2026-11-28, review I5): lists every ref under
   `refs/tarlatan/`, grouped by session id, each with its commit's tree,
   and marks an orphan: a ref that no `SnapshotKept` in the log names
   (left by a crash between the ref and its batch, or by a failed
   deletion). It also names each attempt of the open session with no
   kept end tree. The listing is a read-only capability in
   `StatusCapabilities` (`src/program/status-context.ts:13-24`), built by
   `statusOver` in the harness and by production. When git cannot run
   (git's HOME refused, git fails), status reports the listing as
   skipped with the reason, as the worktree check does, and still exits
   0. Status never writes or deletes a ref.
7. **The restore** (`src/program/restore.ts`; pure judgments in
   `src/features/restore.ts`; git calls in Runtime beside the
   snapshot's). Two functions, so 8b can append its request event
   between them (design, "The restore", step 2; review B4):
   - `precheckRestore(site, target) -> Effect<Option<RestoreRefused>>`
     and `applyRestore(site, target) -> Effect<Restored | RestoreIncomplete | RestoreUnverified>`,
     where `site` is `{ worktree (the recorded identity), base, stateDir }`
     and `target` is `{ tree, excludeDigest }`. Verdicts are
     `Schema.TaggedClass` values: `Restored`, `RestoreRefused { paths, why }`
     (nothing touched), `RestoreIncomplete { paths, messages }` and
     `RestoreUnverified { reason }`. Neither function has a typed error
     channel: before anything is touched, every failure (a pre-check
     snapshot that cannot be taken, `ls-files` or `ls-tree` failing,
     `info/exclude` unreadable, git not starting) is `RestoreRefused`
     with its why; once `applyRestore` has started, every failure is
     `RestoreIncomplete` or `RestoreUnverified` as below.
   - `precheckRestore`, in order:
     - HEAD: refuse when the worktree's HEAD is not `base`.
     - pre-check 1, ignore sources: refuse when any `.gitignore` differs
       between a fresh snapshot of the worktree and the target tree; when
       `.git/info/exclude`'s digest differs from the target's
       `excludeDigest` (`paths` holds `.git/info/exclude`); when any
       `.gitignore` in the worktree is itself ignored; or when the
       repository's config sets `core.excludesFile` (owner, 2026-11-28,
       review I10; `paths` holds `core.excludesFile`).
     - pre-check 2, collisions: list the ignored files
       (`git ls-files --others --ignored --exclude-standard -z`) and the
       target with `git ls-tree -r -t -z <tree>`; refuse when an ignored
       path is any entry of the target, a tree included, or any proper
       ancestor of it is a non-tree entry of the target (the oracle's
       `precheck`, review I4).
   - `applyRestore`: `git read-tree --reset -u <tree>`, `git clean -fd`,
     `git read-tree HEAD`; a failing command here does not stop the
     procedure, and its message goes into the result. Then a fresh
     snapshot: equal to the target is `Restored` (step messages are
     dropped by design); different is `RestoreIncomplete` with the
     differing paths and the messages; a snapshot that cannot be taken
     (raw-check refusal, special file, nested repository, attribute
     refusal) is `RestoreUnverified` (a nested repository's refusal paths
     go into the reason).
   - HEAD, the base and every ref never move. Nothing here appends to the
     log.
8. **Tests without a repository** (coordinator, review B2; AGENTS.md
   "Inject implementations"). Session open and implement now run git, and
   about 60 session tests run on the made-up worktree
   (`test/program/session-harness.ts:97`). Taking and keeping snapshots
   at open, at implement's start and at every end, and deleting refs at
   close, go through one injected capability in `SessionCapabilities`;
   production wires the real one, and the made-up harness supplies a fake
   that records each call and returns a fixed tree and ref. The
   repository harness (`repository: true`) uses the real one. A test
   shows production wires the real capability. The existing assertions
   `expect(harness.gitCalls).toEqual([])`
   (`test/program/findings-recorded.test.ts:106`,
   `test/program/attempt-brief.test.ts:81`) stay, and each gains an
   assertion of the keeper calls now expected.

### Tests (each fact with a counterexample it must not pass)

Tests that run real git use `withHarness({ repository: true })` with
`repositoryHarnessMillis`, or `withRepo` with `repositoryMillis`
(`test/runtime/git-repo.ts:53`) for `restore.test.ts`. "Touching
nothing" means every path's kind, mode, bytes or link text (ignored files
included), the worktree's index file, HEAD and every ref are unchanged.
"The base never moves" means HEAD and the supervisor branch's ref.

| Fact | Counterexample |
|---|---|
| Every attempt records a start and an end `SnapshotKept`, and the session one at open, each with an existing ref whose commit's tree is the recorded tree and whose parent is the session's base. | Checking the events only, not the refs. |
| The batches are in rule 4's order. | A test of membership only. |
| Refs are written in a repository whose config has no `user.name` or `user.email` and sets `user.useConfigOnly=true`. | The harness repository, which sets both (`git-repo.ts:80-81`). |
| A second review and a second correction write new refs; an existing ref makes `update-ref` fail and the command fail before its batch. | A session with one implement and one review. |
| A refused snapshot at open fails it with nothing appended; at implement's start, before batch I with the grant orphaned and waivers kept by rule 3. | A worktree whose snapshot always passes. |
| An end snapshot that is refused (the client adds a nested repository) still appends `Finished` and `ReportRecorded`, with no `KeptAtEnd`, and status names the attempt. | An end snapshot that passes. |
| A review whose worktree changed during the run records an end tree different from its start tree. | A review on an unchanged worktree. |
| `close --finished` removes the session's refs, orphans included; `--abandoned` keeps them; a failed deletion gives `KeptRefsRemain` and status lists the refs; status lists kept refs and an orphan after an abandoned close. | Testing one close kind. |
| Status reports the ref listing as skipped when git cannot run, and exits 0. | A status whose git always runs. |
| `SnapshotKept` raises a log at 1 to 2. | A log at 2. |
| The restore reproduces the target exactly in the oracle's exact classes: mode-only change, symlink and directory swaps, a symlinked directory pointing outside (the outside files kept), tracked and untracked edits. | A target equal to the worktree. |
| Pre-check 1 refuses a differing `.gitignore`, a changed `info/exclude`, a self-ignored `.gitignore`, and a set `core.excludesFile`, touching nothing. | A refusal checked only by tag. |
| Pre-check 2 refuses an ignored file inside a directory the target has as a file, an ignored file whose path the target has, and an ignored file `e` where the target has `e/z`, touching nothing. | An ignored file with no collision. |
| `precheckRestore` refuses when HEAD is not the base, touching nothing. | HEAD always the base. |
| An unremovable untracked file (read-only directory, permissions restored before cleanup) gives `RestoreIncomplete` with its path, and the procedure ran to its snapshot. | A test whose every path is removable. |
| A setting that makes the fresh snapshot refuse (`core.autocrlf=true` in the repository's config, with an LF text file the restore writes) gives `RestoreUnverified`. | A restore whose snapshot always succeeds. |
| Steps 3 and 4 are idempotent (C4): `applyRestore` over a worktree left after only `read-tree --reset -u`, and `applyRestore` run twice, both give `Restored`. | One run only. |
| HEAD, the base and every ref (`for-each-ref` output) never move, and ignored files are kept, in every exact case (C3). | Checking HEAD in one case. |
| A bounded generated test ports the oracle (`research/v0.2.0-restore-oracle/restore_oracle_v5.py`, grammar v2) with `it.prop` (as `test/features/settle.test.ts:116`): 40 runs from a fixed seed under the named timeout; random base, S1 snapshotted as T1, random S2, precheck then restore T1; every result is `Restored`, `RestoreRefused` or `RestoreIncomplete`; a refusal touched nothing; no ignored file is lost silently; `Restored` only when the fresh snapshot equals T1. | Hand-picked cases only. |

### Steps

1. Read `AGENTS.md` first and follow it (layering, Effect v4, TSDoc,
   closed vocabularies, readable functional code). Runtime may import
   only Domain; decoders go in Format, pure judgments in Features, wiring
   in Program. The skills it names are not available in this session.
   Do not edit `AGENTS.md`, `CLAUDE.md`, `eslint.rules.js` or anything
   under `.claude/`.
2. Read the design sections above, `src/program/snapshot.ts`,
   `handoff-facts.ts`, `handoff-git.ts`, `session-context.ts`,
   `review.ts` (where `SnapshotTaken` is appended), `implement.ts`,
   `correct.ts`, `session.ts` (`openSession`, `ExitContext`),
   `attempt.ts`, `attempt-run.ts`, `waiver-expiry.ts`, `status-context.ts`,
   `production-status.ts`, `src/features/command-rules.ts`,
   `src/runtime/git.ts`, `src/runtime/snapshot.ts` and their tests, and
   the oracle scripts.
3. Make the change test-first where you can. Run `bun run docs` and
   `bun run check`.
4. Update the READMEs that describe snapshots, refs, status, the
   raising events, and `implement.ts`'s header ("no snapshot").

### Rules

- Do not delete, skip, rename or loosen any existing test or assertion.
  List in the handoff each existing test you had to change and why. The
  changes expected:
  - new events in exact batch lists (`attempt-protocol.test.ts:45-50`,
    `assisted-cycle.test.ts:60`, `findings-recorded.test.ts:96,104`,
    and any other);
  - `neutralKinds`, the encoded-events fixture (one row per new event),
    the `raisesLogFormat` test's title and count
    (`test/domain/store-version.test.ts:126-129`), `holds.test.ts:165-172`
    if it lists events;
  - tests that assert a log at 1 after a session open
    (`production-status.test.ts:163-164`, `:185-189`, `:205`, `:216`):
    the open now raises the log to 2 (the design: "the raise happens at
    the first session opened by v0.2.0"); keep each such test's fact by
    getting a log at 1 another way (no session opened, or `setVersion`
    after the open), and add the raised case beside it;
  - the git-start count in `repositoryHarnessMillis`'s comment
    (`session-harness.ts:102-124`), re-counted for the new calls; the
    constant's value changes only with the owner.
- In new code use the Effect modules, never native array or string
  methods; named numbers; callback nesting within three levels.
- No lint-disable comments, casts, non-null assertions, or changes to
  lint configuration, check scripts, `package.json`, `bun.lock`,
  `CHANGELOG.md` or CI.
- Do not commit; run no `git` command other than `git status` and
  `git diff`, except inside a test's own disposable repository.

### Done when

`bun run docs` and `bun run check` pass in your step, the owner's
`bun run test` passes after it, and every fact in the table has a test
that would fail on its counterexample. End with a handoff listing every
file changed, where each snapshot and ref is taken (file and line), the
restore's order of steps, each existing test changed and why, and
anything you were unsure about.
