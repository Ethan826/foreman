# Changelog

Tarlatan follows semantic versioning, 0.x for now. The rules, and what
counts as a breaking change, are in
[the roadmap's "Versioning"](docs/plans/2026-11-24-robustness-roadmap.md).
Each entry lists changes to on-disk formats, the CLI, the configuration
and behaviour.

## 0.1.1 (2026-11-25)

The store version check (dogfood-5 and 5b), so that a release refuses a
store written by a newer one instead of misreading it.

- Formats: both SQLite stores, the shared ledger and each project's
  log, hold a format version in SQLite's `PRAGMA user_version`. The
  format is unchanged and is version 1. A store at 0, written by
  v0.1.0, is stamped 1 by the first command that opens it; v0.1.0 never
  reads the field, so it keeps working on a stamped store.
- CLI: a store stamped higher than 1 fails every command that opens it
  with `StoreVersionNewer` (`path`, `found`, `known`), and a negative
  version with the store's own error. `status` gains `storeVersions`
  (`log`, and `ledger` when a ledger is read), the header values as
  read, and reports a newer or negative shared ledger as a finding
  without reading its rows, still exiting 0.
- Configuration: unchanged.
- Behaviour: opening the project log now takes its write lock briefly,
  as opening the ledger already did. `status` reads each store's version
  and rows from one snapshot.

## 0.1.0 (2026-11-24, tag only)

The first release, tagged at 1c564bd so that Waxwing and durable-effect
can run a fixed tarlatan while its development continues.

- Formats: the project log, the shared ledger, the target binding and
  the state files as of the assisted cycle (slices A1 and A2) and the
  dogfood cycles 1 to 4. The ledger has no schema version.
- CLI: `worktree create`, `session open`, `implement`, `review`,
  `correct`, `reject`, `status`, `step-ended` and `session close`.
  Every command prints the client's event stream as well as its result.
- Configuration: `projectId`, `stateDir`, `ownerCheckout`,
  `supervisor`, `ledgerDir`, `attributeAllowance` (none, or Waxwing's
  line), `pins` and optional `checkCommands`.
- Behaviour: no retry after an interrupted step; the reviewer sees the
  task but not the owner's findings files; only a review without
  findings allows `session close --finished`; pacing is not wired, so
  every launch needs `--waive`.
