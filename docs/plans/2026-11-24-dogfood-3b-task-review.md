# Review of the dogfood-3b task draft (2026-11-24)

A fresh Opus review agent read the first draft of the dogfood-3b task
against 11165c8, read-only, before any session ran (168,410 tokens).
The coordinator recorded its findings here; the full report is in the
session transcript.

Blocking: B1, the authorized test changes did not cover call sites the
task forces (brief inputs in `brief.test.ts`, `assisted-cycle.test.ts`,
`attempt-protocol.test.ts`; `SessionSettings` in `session-harness.ts`;
a status contract pinned in `test/facade/status-read-only.test.ts`);
B2, four `claudeEditingSettings` calls in the L3 package run under
`bun -e`, outside tsc and verify, and would break silently.

Important: I1, `CheckCommandRefused` must be classified (refusal or
failure); I2, where a refused command is caught; I3, the shape of
`PublishClaudeProfile`; I4, the brief line's position and bytes; I5,
`ProductionStatusReport`'s documented five fields; I6, the draft
invited an edit of AGENTS.md, which the profile denies; I7, an exact
`Bash(<command>)` rule limits the command line, not what runs, so a
check command that runs repository code is arbitrary code execution in
the sandbox, and the owner's unsandboxed verify in the supervisor
worktree runs ignored paths (`node_modules`) no reviewer saw; I8, no
existing test pins the settings bytes. Minor: M1 to M7 (the refusal
prefixes, Schema's unique-items message, a nonexistent 250-line limit,
prose-gate risk, a stale README sentence, the L3 stand-in, a home for
the binding test). On running verify inside the sandbox (reasoning,
not observation): temp-directory writes, a Unix-socket bind in
`snapshot-preflight.test.ts` and `ps` may fail there; verify takes
close to the Bash tool's two-minute default.

Owner rulings (2026-11-24): a refused check command is caught at
configuration decode (`ConfigUndecodable`), with the profile's check
kept as a second guard; a launch refused for one is a refusal that
expires armed waivers. Every other finding was written into the task.
Follow-ups: one live run of `bun run verify` under the rendered profile
before the cycle that uses it, recording which tests fail in the
sandbox and why; the owner's own verify should run on a fresh checkout
of the snapshot tree with a fresh install (the check-step proposal).
