# Dogfood-8: snapshots kept by ref, and the restore

## Task

Slice 3 of v0.2.0, first half ([design](2026-11-25-session-recovery-and-rulings-design.md),
"Retry and back-up": "What is kept" and "The restore", the "Adversarial
review" section with its claims C1 to C4, C7 and restrictions;
[plan](2026-11-25-session-recovery-and-rulings-plan.md), tasks 3.1 and
3.3). Slices 1 and 2 are on `main` (ff8b86a). The second half,
dogfood-8b, adds the session line, `back-up` and `retry`, which use
what this task builds. No new command here.

1. Every attempt's start and end tree, and the tree a session opens on,
   are kept as commits on private refs, so `git gc` cannot prune them and
   a later back-up can restore them.
2. A restore procedure puts a kept tree back onto the supervisor
   worktree, or refuses touching nothing, or reports exactly what it
   could not restore. It is a Program function with its tests; nothing
   calls it yet.

### Owner rulings for this task (do not reopen)

1. The design is approved (2026-11-25) with its adversarial review; the
   restore's pre-checks and outcomes are as the design states.
2. **Event.** `SnapshotKept { sessionId, point, tree, ref, excludeDigest }`
   in `src/domain/session-events.ts`, joining `ProjectEvent`;
   `raisesLogFormat` returns true for it. `point` is a union of
   `Schema.TaggedClass` values `KeptAtOpen`, `KeptAtStart { opId }` and
   `KeptAtEnd { opId }` (no string vocabulary). `excludeDigest` is the
   SHA-256 of `.git/info/exclude` in the common git directory, or of the
   empty input when the file is absent. `SnapshotTaken` keeps its meaning
   and shape.
3. **Where snapshots are taken.** `session open` takes one before it
   appends `SessionOpened`'s batch and records `KeptAtOpen` in that
   batch. Every launch (implement, review, correct) takes one in its
   batch I (`KeptAtStart`) and one in its batch F (`KeptAtEnd`); for a
   review the two trees are equal. Use the existing snapshot procedure
   (`takeSnapshot`, `src/program/handoff-facts.ts:76`) and its raw
   checks; a snapshot that fails them fails the command as today's
   review snapshot does.
4. **Refs** (a new `src/runtime/snapshot-refs.ts`, git through
   `pinnedGitWith`/`snapshotGitWith` in `src/runtime/git.ts`): for each
   kept tree, `git commit-tree <tree> -p <base>` (message naming the
   session, the point and the opId), then `git update-ref <ref> <commit>
   <zero-oid>` so the ref must not exist, before the log batch that
   records it. Names: `refs/tarlatan/<sessionId>/open`,
   `refs/tarlatan/<sessionId>/<opId>/start`, `.../<opId>/end`. A failing
   `update-ref` fails the command before its batch. `session close
   --finished` deletes the session's refs after its batch; other closes
   keep them. A Runtime function lists a session's refs
   (`for-each-ref refs/tarlatan/<sessionId>/`).
5. **Status** lists the session's kept refs and any orphan (a ref with no
   `SnapshotKept` naming it, left by a crash between the ref and the
   batch).
6. **The restore** (`src/program/restore.ts`, Runtime git calls
   beside the snapshot's): `restoreTree(worktree, target: { tree,
   excludeDigest }) -> Effect<RestoreVerdict>` with
   `Restored`, `RestoreRefused { paths, why }` (pre-checks; nothing
   touched), `RestoreIncomplete { paths, messages }` and
   `RestoreUnverified { reason }`, as `Schema.TaggedClass` values. In
   order, as the design's "The restore" states:
   - pre-check 1, ignore rules: refuse when any `.gitignore` differs
     between a fresh snapshot of the worktree and the target tree, when
     `.git/info/exclude`'s digest differs from the target's
     `excludeDigest`, or when any `.gitignore` in the worktree is itself
     ignored;
   - pre-check 2, collisions: refuse when an ignored file in the
     worktree (`git ls-files --others --ignored --exclude-standard -z`)
     has its own path in the target, or an ancestor path that is a
     non-directory entry of the target;
   - then `git read-tree --reset -u <tree>`, `git clean -fd`,
     `git read-tree HEAD`; a failing command here does not stop the
     procedure, and its message goes into the result;
   - then a fresh snapshot: equal to the target is `Restored`; different
     is `RestoreIncomplete` with the differing paths; a snapshot that
     cannot be taken (raw-check refusal, special file, nested repository)
     is `RestoreUnverified` (a nested repository's refusal paths go into
     the reason).
   HEAD and the base never move. Nothing here appends to the log; 8b
   wraps it in request and result events.

### Tests (each fact with a counterexample it must not pass)

| Fact | Counterexample |
|---|---|
| Every attempt records a start and an end `SnapshotKept`, and the session one at open, each with an existing ref whose commit's tree is the recorded tree. | Checking the events only, not the refs. |
| A second review and a second correction write new refs; an existing ref makes `update-ref` fail and the command fail before its batch. | A session with one implement and one review. |
| `close --finished` removes the session's refs; `--abandoned` keeps them; status lists them and an orphan. | Testing one close kind. |
| `SnapshotKept` raises a log at 1 to 2. | A log at 2. |
| The restore reproduces the target exactly in the oracle's exact classes: mode-only change, symlink and directory swaps, a symlinked directory pointing outside (the outside files kept), tracked and untracked edits. | A target equal to the worktree. |
| Pre-check 1 refuses a differing `.gitignore`, a changed `info/exclude`, and a self-ignored `.gitignore`, touching nothing (file bytes and HEAD unchanged). | A refusal checked only by tag. |
| Pre-check 2 refuses an ignored file inside a directory the target has as a file, and an ignored file whose path the target has, touching nothing. | An ignored file with no collision. |
| An unremovable untracked file (read-only directory) gives `RestoreIncomplete` with its path, and the procedure ran to its snapshot. | A test whose every path is removable. |
| A setting that makes the fresh snapshot refuse (`core.autocrlf=true` in the repository's config, with LF files) gives `RestoreUnverified`. | A restore whose snapshot always succeeds. |
| HEAD and the base never move, and ignored files are kept, in every exact case. | Checking HEAD in one case. |
| A bounded generated test ports the oracle (`research/v0.2.0-restore-oracle/restore_oracle_v5.py`, grammar v2): random base, S1 snapshotted as T1, random S2, restore T1; every result is `Restored`, `RestoreRefused` or `RestoreIncomplete`, never a silent loss of an ignored file, and `Restored` only when the fresh snapshot equals T1. | Hand-picked cases only. |

### Steps

1. Read `AGENTS.md` first and follow it (layering, Effect v4, TSDoc,
   closed vocabularies, readable functional code). The skills it names
   are not available in this session. Do not edit `AGENTS.md`,
   `CLAUDE.md`, `eslint.rules.js` or anything under `.claude/`.
2. Read the design sections above, `src/program/snapshot.ts`,
   `handoff-facts.ts`, `review.ts` (where `SnapshotTaken` is appended),
   `implement.ts`, `correct.ts`, `session.ts` (`openSession`),
   `attempt.ts`, `attempt-run.ts`, `src/runtime/git.ts` and their tests,
   and the oracle scripts.
3. Make the change test-first where you can. Run `bun run docs` and
   `bun run check`. Tests that run real git use the repository harness
   and its named timeout (dogfood-6e).
4. Update the READMEs that describe snapshots, refs, status or the
   raising events.

### Rules

- Do not delete, skip, rename or loosen any existing test or assertion;
  list in the handoff each existing test you had to change (new events
  in exact batch lists, `neutralKinds`, the encoded-events fixture with
  one row per new event, the `raisesLogFormat` count) and why.
- In new code use the Effect modules, never native array or string
  methods; named numbers; callback nesting within three levels.
- No lint-disable comments, casts, non-null assertions, or changes to
  lint configuration, check scripts, `package.json`, `bun.lock`,
  `CHANGELOG.md` or CI.
- Do not commit; run no `git` command other than `git status` and
  `git diff`.

### Done when

`bun run docs` and `bun run check` pass in your step, the owner's
`bun run test` passes after it, and every fact in the table has a test
that would fail on its counterexample. End with a handoff listing every
file changed, where each snapshot and ref is taken (file and line), the
restore's order of steps, each existing test changed and why, and
anything you were unsure about.
