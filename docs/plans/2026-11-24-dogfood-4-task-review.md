# Review of the dogfood-4 task draft (2026-11-24)

A fresh Opus review agent read the first draft of the dogfood-4 task
(the rename) against 3ebedd0, read-only (150,226 tokens). The
coordinator recorded its findings here and wrote them into the task.

Blocking: B1, the worktree lock reason `foreman` (`src/runtime/worktree.ts`)
was in no bucket; B2, `bun.lock` names the package too and was in no
bucket, so the done-when could not be met. Important: I1, user-visible
messages that name the tool were not authorized; I2, the L3 package
stores three markers (scratch-root header, path-record header, the
README line `score.py` compares) that old roots and evidence depend
on; I3, the default ledger name changes the binding of a configuration
that omits `ledgerDir`; I4, string pairs between production and tests
that only the suite catches, some of which pass vacuously if half
renamed; I5, history lines inside living files. Minor: M1 to M8
(temporary prefixes live only in `test/`; `docs/diagrams/` and
`lint-fixtures/` must not be edited; identifiers in any case; the
Mermaid alias; the docs URL would 404 until cutover; staged renames;
the done-when needs a Grep form; `events.test.ts` is safe to rename).

Coordinator decisions (stricter option, no product question): stored
formats keep their names and become listed exceptions; the lock reason
becomes `tarlatan`; the docs-site URL changes at cutover; `bun.lock`
joins the coordinator's files.
