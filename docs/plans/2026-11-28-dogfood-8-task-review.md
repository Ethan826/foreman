# Review of the dogfood-8 task draft (2026-11-28)

A fresh Opus review agent read the first draft of the dogfood-8 task
(snapshots kept by ref, `SnapshotKept`, the restore) against ff8b86a,
read-only, with no git and no test runs (208,117 tokens). The
coordinator checked the blocking claims against the code, brought four
product decisions to the owner, and wrote every finding into the task.

Blocking: B1, `commit-tree` had no committer identity, since production
git reads no global config (now a fixed `-c user.name=tarlatan -c
user.email=tarlatan@invalid`, with a test in a repository that has none);
B2, open and implement now run git while about 60 session tests run on a
made-up worktree, and two tests assert implement runs none (now an
injected keeping capability the made-up harness fakes); B3, "fails as
today's review snapshot does" could not hold at open, at implement's
start or after the client ran (owner decision); B4, one `restoreTree`
left no place for 8b's request event between the pre-checks and the
restore (now `precheckRestore` and `applyRestore`).

Important: I1, the code sites and batch order (now stated, and the
waiver class of a ref failure); I2, a review's end tree (owner
decision); I3, the restore lacked the base, the state directory, a HEAD
check and a verdict for every failure; I4, pre-check 2 missed an ignored
file where the target has a directory (now `ls-tree -r -t`); I5, status
had no git capability and no rule for which refs to list (owner
decision); I6, tests asserting a log at 1 after open; I7, no bound on
the generated test (now 40 runs, fixed seed); I8, ref deletion at
`close --finished` unspecified (now `KeptRefsRemain`); I9, no rows for
C3 and C4; I10, `core.excludesFile` in the repository's config escapes
pre-check 1 (owner decision); I11, Runtime may import only Domain.
Minor: M1 to M7 (one constant for ref segments, the `autocrlf` and
read-only rows, "touching nothing" defined, dropped step messages, the
named harnesses, `SnapshotKept` kept out of `OpenSession`, the kept
commit's parent).

Owner rulings (2026-11-28): B3, open and a launch's start fail before
their batch when the snapshot or ref fails; the end always appends
`Finished` and adds `KeptAtEnd` only on success, status naming the gap.
I2, a review takes a fresh end snapshot and records the tree found, with
no refusal when it differs. I5, status lists every ref under
`refs/tarlatan/` by session with orphans marked, and reports the listing
skipped when git cannot run. I10, the restore refuses when the
repository's config sets `core.excludesFile`.
