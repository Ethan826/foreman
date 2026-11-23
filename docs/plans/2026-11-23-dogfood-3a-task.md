Guard the supervisor's git directories and refuse work on a moved HEAD.

### Goal

Claude's editing profile will later allow one configured check command
(dogfood-3b), which runs code the agent can edit. The L3 live run showed
that code run inside the Bash sandbox can commit: in case C4, `git
commit` from an allowed script wrote an object and moved the supervisor
branch in the repository's common git directory
(`research/live/l3-subset/results.md`). The owner ruled that no command
that runs arbitrary code is allowed until a commit guard exists and a
C4 rerun shows it holds. This task builds the guard. It adds no allowed
command.

### Owner rulings for this task (2026-11-23; do not reopen)

1. The sandbox denies writes to the session's recorded common git
   directory and the worktree's own git directory, each as a whole.
   `git status` and `git diff` then cannot refresh the worktree's index;
   git skips that silently and still exits 0 with correct output (shown
   by simulation; the live rerun confirms it).
2. A moved HEAD refuses work. While a session is open, a supervisor HEAD
   that differs from the session's base revision refuses `implement`,
   `review`, `correct` and `session close --finished`. It never refuses
   `reject`, `step-ended`, `session close --abandoned`, `session close
   --interrupted` or `status`; the owner's exits still run no git. This
   replaces the earlier behaviour in which a launch judged the session's
   base and ignored a moved HEAD (batch review B07); the attribute check
   still judges the base.
3. The test changes listed under "Authorized test changes" are approved,
   and no others.

### Behaviour wanted

1. **Sandbox denials.** `claudeEditingSettings` in
   `src/format/claude-settings.ts` takes the session's recorded
   `RecordedGitIdentity` (`src/domain/session.ts`: `path`, `gitDir`,
   `commonDir`) instead of the worktree path alone, and adds
   `<commonDir>` and `<gitDir>` to `sandbox.filesystem.denyWrite`, after
   the existing entries. Each of the three paths is checked as the
   worktree path is today, failing with `ProfilePathUnsafe`. Nothing else
   in the template changes. `PublishClaudeProfile`
   (`src/program/claude-profile.ts`) takes the identity; `implement` and
   `correct` pass `session.opened.worktree`, which `SessionOpened`
   records.
2. **HEAD check as a Features rule.** Add a refusal `HeadMoved { base,
   head }` (both `Revision`) to `src/features/command-refusals.ts` and to
   the `Refusal` union. `CommandChecks` (`src/features/command-rules.ts`)
   gains the HEAD reading, and a rule refuses when it differs from the
   open session's base. Use it in the launch rules and the `Finished`
   close rule only. Program supplies the reading: the launches from the
   startup check's existing HEAD read (`worktreeReading`), and `session
   close --finished` from a narrow HEAD read (`git rev-parse HEAD`
   through the runner pinned to the session's recorded identity), with no
   identity or attribute check added to close. The owner exits' contexts
   (`ExitContext`, `StepEndedContext`) stay without git. Do not put the
   comparison in `checkedHead` or anywhere in Program.
3. **Failures stay failures.** A HEAD read that fails (`GitCommandFailed`,
   `GitOutputUndecodable`) keeps its own failure and keeps the waiver
   (owner ruling on B11c and R01). Only a successful read that differs
   from the base is the `HeadMoved` refusal, which expires the waiver as
   any refusal does (`isRefusal` in `src/program/waiver-expiry.ts`
   already classifies `CommandRefused`).
4. **status** reports a moved HEAD as a finding while a session is open,
   and writes nothing.

### Authorized test changes (and no others)

- (a) `test/program/production-attributes.test.ts`, "a launch judges
  the session's base, not a HEAD that moved since": after the commit in
  the worktree, `implement --waive` exits 1 with `CommandRefused` whose
  only reason is `HeadMoved`, naming the session base and the new HEAD,
  and with no `WorktreeCheckFailed` or `AttributeSourcesRefused`. Rename
  it to say that a moved HEAD is refused while the attribute check still
  judges the base.
- (b) `test/format/claude-settings.test.ts`, "binds every file rule and
  every sandbox path to the worktree": keep its file-rule assertions and
  their count. Its sandbox assertion becomes: every `denyWrite` path is
  the worktree, a path inside it, or exactly the recorded `gitDir` or
  `commonDir`.
- (c) `expectedProfile` in `test/program/production-profile.test.ts`
  gains the two denials for the layout's recorded git directories.
- (d) Call sites and fixtures that the new signatures force:
  `test/program/session-harness.ts`, `test/program/waiver-refusals.test.ts`,
  and the `CommandChecks` fixtures in `test/features/`
  (`command-fixtures.ts`, `command-rules.test.ts`,
  `command-close.test.ts`).

### Steps

1. Read `AGENTS.md` first and follow it (layering, Effect v4, TSDoc,
   closed vocabularies, the 250-line limit). The skills it names are not
   available in this session; follow the surrounding files.
2. Write new tests first: the rendered settings carry both denials and
   refuse an unsafe `gitDir` or `commonDir`; the Features rule refuses a
   moved HEAD for each of `implement`, `review`, `correct` and `close
   --finished`, and never for `reject`, `step-ended`, `close
   --abandoned`, `close --interrupted`; a failed HEAD read keeps its own
   failure and the waiver; `status` shows the finding and writes
   nothing.
3. Update the L3 package for the new signature:
   `research/live/l3-subset/profile.sh`, `run-case.sh` and
   `test-scripts.sh`. The owner runs `sh
   research/live/l3-subset/test-scripts.sh <absolute scratch dir>`; it is
   not part of `bun run verify`.
4. Update the documentation: the `claude-settings.ts` header comment,
   `src/format/README.md`, `src/program/README.md` (including its B07
   sentence and the owner's recovery step below), the `checkedHead`
   TSDoc, and the AC1 table in
   `docs/plans/2026-11-19-assisted-cycle-plan.md` (`close --finished` now
   needs a HEAD read; the other closes do not).
5. Owner's recovery step, to document in `src/program/README.md`: when
   a session is refused for `HeadMoved`, the owner inspects `git log
   <base>..HEAD` in the supervisor worktree, resets the branch to the
   base if the commits are not wanted, and then closes or continues;
   abandoning without that leaves the next session based on the moved
   HEAD, so the agent's commit would never be reviewed.

### Rules

- Do not delete, skip, rename or loosen any existing test or assertion
  except as authorized above.
- Use the Effect modules, never native array or string methods, in
  source and tests; give an arrow that calls a void function a block
  body; keep callback nesting within three levels (extract named test
  bodies).
- No lint-disable comments, no type casts, no non-null assertions, no
  changes to lint configuration, check scripts, `package.json`,
  `bun.lock` or CI.
- Do not commit, and do not run `git` commands other than `git status`
  and `git diff`. This session cannot run `bun`; the owner runs `bun run
  verify` and the L3 script tests after your step.

### Done when

- the behaviour above holds and is tested;
- `bun run verify` and `sh research/live/l3-subset/test-scripts.sh`
  pass, run by the owner.

End with a handoff that lists every file you changed or added, the new
types and where they are registered, the tests you added and what each
shows, each authorized test change you made, and anything you were
unsure about.
