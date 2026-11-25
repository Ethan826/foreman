# Changelog

Tarlatan follows semantic versioning, 0.x for now. The rules, and what
counts as a breaking change, are in
[the roadmap's "Versioning"](docs/plans/2026-11-24-robustness-roadmap.md).
Each entry lists changes to on-disk formats, the CLI, the configuration
and behaviour.

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
