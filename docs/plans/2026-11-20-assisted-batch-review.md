# Assisted batch review

Date: November 20, 2026. Verdict: CORRECT BEFORE LANDING OR L3.
Reviewed range: main `4604c7c6ea3d84aa6a5b500b0ed592b8d6a0b948` through
assisted `9c3b48c280d8279388c803cad6942102720eedd1` (implementation ends
at `2c4ecd3`; the final commit changes the execution record).

This was a batch review of B11d, W1, A1 and A2, not implementation,
landing, publication or permission to run L3. All checkout reads used
committed content or the unmodified assisted checkout. Checks and probes
used a separate archive under `/private/tmp/foreman-assisted-review-6F84tN`.
No original source, branch or user file was changed, and no Git mutation
command was run in the original checkout.

One fresh-context GPT-6.2-astra reviewer read the complete U10 diff and
requirements, with a 100k to 200k planning estimate. No further agents
were dispatched. Its actual token usage is unavailable here. The primary
reviewer independently inspected the launch/session flow, evaluated its
findings, ran the required checks, and ran the bounded probes below.

## Findings and bounded corrections

Every row is PROPOSED FOR CORRECTION unless explicitly marked as a limit
or owner decision. A green suite does not close these findings. Listed
file/line references refer to assisted at the reviewed head.

| ID | Severity | Finding and evidence | Required correction/evidence |
|---|---|---|---|
| B01 | Critical | L3 teardown does not establish scratch ownership. `research/live/l3-subset/teardown.sh:31` accepts a generic owner/state/remote.git directory instead of requiring its marker, then chmods and recursively deletes directories at lines 40–48. `setup.sh:94` tells the owner to teardown on a conflicting preexisting directory. A mistaken scratch path can delete unrelated data. Static inspection; no destructive probe. | Claim a fresh, canonical scratch root exclusively before the first write, record ownership and intended cleanup paths, and refuse teardown without the matching ownership record. Preserve unrelated existing files. Test a preexisting state directory with a sentinel and partial setup/teardown. Do this before any L3 setup or live call. |
| B02 | Critical | Production fails Git's private empty HOME precondition. `src/program/production.ts:67` uses stateDir/git-home without creating, owning or validating it. `src/program/attribute-sources.ts:50` explicitly assigns that duty to the caller. A bounded real-repository probe populated HOME/.config/git/attributes and a local clean filter: the production attribute check and snapshot both passed, and the filter executed a marker command. | Supply a runtime-owned private, empty Git HOME before any Git effect. Refuse contamination, linked paths and unsafe reuse; never clear an arbitrary existing directory. Exercise the actual production factory with planted fallback attributes and helper markers; nothing may execute. |
| B03 | Important, safety boundary | P4's fixed Claude editing permissions are not established. `src/format/foreman-config.ts:57` accepts any absolute settings path; `src/domain/profiles.ts:50`, implement and correct pass it unchanged. Production accepted an existing `{}` file in the probe. No sandbox/protected-path/network policy or target binding was checked. This does not prove an actual client escape; L3 has not run. | Generate the fixed profile or validate an immutable, owner-provisioned profile against the recorded worktree before admission, and launch with those exact bytes. Test empty/missing settings, disabled sandbox and another worktree's rules through production. Decide inherited user settings/hooks separately before L3; do not silently select that policy. |
| B04 | Important | State and target configuration are not bound. `production.ts:68,80` takes the current config's allowance and settings while `command-start.ts:45` selects WorktreeCreated from the chosen state directory. Config projectId, supervisor path/name and owner target are not matched to that record. Reusing stateDir in another config can operate on the original repository with different permissions, allowance and accounting identity. | Persist/validate the canonical target/project binding and refuse mismatches before stores or launch/Git effects as appropriate. Keep inspection/close paths reachable. Test a copied config with unchanged stateDir and changed target, supervisor, project and policy. |
| B05 | Important | Layout validation checks only absolute strings. `foreman-config.ts:50–57` allows a supervisor worktree inside the owner's checkout or state/settings inside the client worktree. Production accepted owner/nested in the probe. This violates the worktree separation and durable-state boundary. | Enforce the approved canonical stateDir/worktree layout outside the owner's checkout, with state/profile/release inputs outside client write access, including linked ancestors. Refuse invalid layouts before initializing stores or Git. Test nested and symlinked layouts and unchanged owner files. |
| B06 | Important | The W1 allowance is a general arbitrary-line escape, not only the approved Waxwing line. `src/domain/attributes.ts` accepts any newline-free configured string, and `src/features/attribute-sources.ts:140` accepts exact membership. Production accepted `*.txt filter=evil` in the probe. Default empty is safe; configuration can nevertheless enable conversions, filters, diff/merge attributes or macros that the owner explicitly kept refused. | Restrict the production policy to the approved exact root line for the bound Waxwing identity, empty elsewhere. Do not expose a generic arbitrary-attribute policy without a separate owner ruling. Retain other-source and nested-file refusal; test conversion/filter/macro lines supplied in config, wrong target and duplicate policy cases. |
| B07 | Important | Handoffs check old attributes, not candidate attributes. `src/program/handoff-facts.ts:70` calls checkAttributes(session base) before staging. The new candidate tree is only checked for raw bytes/modes. A real probe added `* text` to the candidate: base attribute check and snapshot passed, while checking the resulting tree correctly refused it. Startup also reads WorktreeCreated.base rather than a then-current base. | Keep pre-staging metadata/source safety checks, then judge actual candidate attribute blobs before passing the candidate to a client; no execution of candidate filters as part of validation. Check the actual launch/session base at startup. Test added/edited root and nested attribute files, refused macros/conversions and the approved Waxwing line. |
| B08 | Important | Snapshot refuses gitlinks only after read-tree/add/write-tree. FIFOs/sockets that Git omits may never reach `judgeSnapshot`. `src/program/snapshot.ts:73–79` contradicts M14's pre-staging refusal; the current real test proves only eventual gitlink refusal. | Preflight covered entries/base gitlinks without following links and refuse unsupported topology/types before staging. Test that add/write-tree are not reached for a gitlink, nested repository, FIFO or socket. |
| B09 | Important | Production creates a different ledger per state directory. `src/program/production.ts:73` always opens stateDir/ledger.sqlite, with no shared-ledger configuration/binding. Two production contexts in the probe created separate files. Sequentially switching targets does not restore the earlier target's reservations to the new ledger. | Use the one owner/account ledger across project states and bind it durably; keep project logs and project locks separate. Test two production contexts against the same ledger and refusal of an unintended changed ledger. No allocation/rate-fit work is needed. |
| B10 | Important | Per-role estimate overrides contradict approved P5. `src/format/foreman-config.ts:58,108` and production accept estimates down to zero; the probe accepted zero for all roles. The owner approved the existing 15-point initial estimate. A new config test asserts non-15 overrides. | Use P5's estimate or obtain an explicit different owner ruling with required floors. Test actual production grant amounts, not only config decoding. Do not adjust a test merely to suppress the conflict. |
| B11 | Important | `status` is not read-only in production. `production.ts:72–74` opens creating databases for every command; `command-start.ts:73` reads the ledger inside its write transaction, whose Runtime uses BEGIN IMMEDIATE. The worker recorded the behavior but it contradicts AC1. | Add a non-creating status construction and read-only consistent ledger read. Show no files created for a missing state, no writes on an existing state, and usable status under an unrelated active ledger writer. No project lock may be taken. |
| B12 | Important | Process evidence hides the normal-exit case and overstates the spawn gap. `src/program/status.ts:83,99` only reports incomplete attempts, so finished leaders' surviving groups are absent before --attest. Line 119 says NotLaunched for Intended without Launched even though spawn precedes batch L. | Show advisory evidence for all recorded launches in the open session, including finished leaders. Label an unrecorded launch as unknown/possibly running. Preserve the reused-ID/escaped-descendant caveat. Tests must cover normal leader exit with a live descendant and spawn-before-L ambiguity. |
| B13 | Important | Malformed client output can still become Success. `src/program/client-output.ts:41–46` silently discards JSON/schema failures. Pure probes returned Success for a Claude success followed by invalid JSON, and for a Codex turn.completed followed by a malformed known error event. | Carry decoding failure into pure classification and make it close-only Unclassified. Distinguish supported irrelevant stream events from malformed JSON or malformed outcome-bearing events, so ordinary vendor stream items remain usable. Add both counterexamples and benign-extra-event controls. |
| B14 | Important | Exact briefs are not kept. `src/program/attempt.ts:128` prepares text and attempt-run.ts passes it in argv, but AttemptFiles contains no brief path/hash and nothing publishes it. This violates the durable handoff goal and loses evidence of what each fresh client actually received. | Publish the exact submitted brief before batch I, associate its path/hash with the attempt durably, and treat missing/changed artifacts appropriately. Test received argv bytes equal the recorded brief, including restart and publication failures. |
| B15 | Important | Unused waivers can survive the next attempt. `src/program/attempt-admission.ts:48` reads only the selected provider's waiver; the attempt does not expire an unused other-provider waiver, or consistently expire one on a refusing attempt. This is recorded worker debt, not an approved lifecycle change. | Apply the existing one-attempt consume/expire rule, preserving the approved retry after W. Test a pending other-provider waiver with admitted/refused attempts, a non-quota refusal and close. |
| B16 | Important, gate scope | The process gate grants wider imports than the recorded ruling. `test/runtime/process-gate-scan.ts:39,170` exempts all processModules for every starter, including Bun/cluster in the three new Runtime boundaries. The owner authorized child_process there and explicit-env starts. No actual extra production import was found. Production coverage also checks worktreeProgram's definition while CLI uses the configurable factory in production.ts. | Narrow new import/API privileges to the recorded ruling; retain the preexisting git.ts policy. Add must-fail Bun/cluster cases in each new starter and exercise the actual production composition. An owner may instead explicitly rule on any broader policy; the agent cannot widen it by inference. |
| B17 | Important, exact-byte boundary | Git output is decoded lossily before path/content validation (`src/runtime/git.ts:86`). Invalid filename bytes can become U+FFFD, colliding with a genuine replacement-character path; snapshot observations are keyed by the resulting string. The worker claim that all such paths refuse as unreadable is not established. This is a code-trace argument, not a reproduced acceptance case. | Preserve raw bytes or reject invalid UTF-8 before replacement. Test invalid bytes and genuine U+FFFD names together, plus decoded attribute content. The narrow ASCII W1 production policy also limits that attribute case. Do not claim arbitrary exact-path validation until this is resolved. |

## Conditional process/filesystem limits and owner decisions

| ID | Status | Disposition |
|---|---|---|
| L01 | OWNER DECISION / runner fixture needed | Runtime exit and output completion use child close, and Program drains stdout first (`runtime/spawn.ts:179`, `program/attempt-run.ts:66`). A descendant retaining an inherited pipe can keep the command/project lock alive after the leader exits. The existing lingering fixture gives its child separate pipes. Require a real inherited-pipe fixture and define the owner's interruption/cleanup path. For this no-signaling rung, an explicit owner-approved manual interruption rule may be sufficient; this review does not mandate an automatic kill or a new OS containment design. |
| L02 | LIMIT, not a new concurrent-writer guarantee | O_NOFOLLOW protects the leaf, not intermediate path components (`runtime/worktree-entries.ts:61,69`). A directory swapped to an external symlink between staging and raw reads can redirect reads. The primary reviewer treats this as conditional on violating the assisted rung's quiescence/no-concurrent-writer precondition, which already limits snapshot observations. Narrow the unconditional no-follow wording and preserve that assumption. Stronger adversarial concurrent-writer protection would need a separately reviewed root-anchored mechanism, not an improvised helper in this batch. |
| L03 | PENDING OWNER DECISION | Whether inherited Claude user settings/hooks load during L3 and real sessions remains unresolved. Test the exact selected profile/pins after the owner rules. This review launches no live client. |
| L04 | ACCEPTED EXISTING LIMIT | B11d documents that GIT_COMMON_DIR alone does not bind every ref read on the probed Git version. Preserve non-tautological identity checks and the recorded limitations. Future ref writes/full protected digests remain outside this batch. No unsupported concurrency-proof identity claim is made. |

## Minor findings and recorded follow-ups

| ID | Status | Finding / next action |
|---|---|---|
| M01 | PROPOSED CORRECTION | Status omits snapshot coverage even though review briefs include it. Add the existing statement to serialized status. |
| M02 | PROPOSED CORRECTION | `src/program/review.ts:119` converts every last-message read failure to an empty handoff. Only absence means no message. Preserve permission/I/O failure rather than silently recording a different outcome. |
| M03 | PROPOSED CORRECTION | `src/runtime/state-files.ts:115` can leak the directory descriptor when fsync fails. Close in a finalizer and retain the original failure. |
| M04 | PROPOSED CORRECTION | RecordedGitIdentity documents absolute paths but decodes nonempty text (`domain/session.ts:76`). Enforce the documented boundary. |
| M05 | PROPOSED CLEANUP / not a launch blocker by itself | Step-outcome repeats Format's Codex wire tags, with a drift test. Prefer a single boundary-to-Domain conversion when touching classification for B13; do not invent new wire semantics. |
| M06 | FIX BEFORE L3 | L3 snapshot.sh omits unexpected scratch-root files and has newline/command-substitution ambiguities. setup.sh substitutes unescaped scratch paths into JSON and shell-sourceable layout.env. Inventory the whole owned scratch tree excluding output, encode paths for each format and fail on hash/enumeration errors. Keep this with B01's offline L3 preparation correction. |
| M07 | RECORD LIMIT / OWNER RULING | Current classification never produces RateLimited/AuthFailed/PermissionDenied; these become close-only Unclassified. This is a capability limit. Use vendor evidence for more specific classification, never guessed text matching. |
| M08 | DOCUMENTATION UPDATE | AGENTS.md's vocabulary inventory is updated, but its status still says implementation stops before the now-authorized assisted work. Reconcile status/checkpoint with the approved execution record before landing. Do not mark L3 complete. |
| M09 | DEFERRED AS ALREADY RULED | The overlength ESLint config and admission test, and the owning-skill gate lift, remain explicit debt. No cleanup or skills-repository write is authorized by this review. |

## Worker open-item dispositions

Bare final CR refusal is consistent with the exact-line terminator rule.
Free-text severity and ignored unknown finding JSON keys do not have a
contrary approved schema requirement in this batch. No rename detection
with -M produces delete/add paths rather than a wrong tree. Verbatim task
and handoff text in briefs, mixed raw stdout/stderr, ps's one-second and
newline limits, and JSON Option representation are documented limits.
The last editing handoff for correct is consistent with supplying only
the owner's selected findings; the additional SnapshotRefused before
any review is misleading diagnostics, not permission to launch.

These choices are not new machine guarantees. No live permission or
protocol result is inferred from them. Production's no-monotonic-stamp
behavior still needs explicit one-launch waivers (O11). Repeated Codex
Q/W pairs follow the current default policy; no nightly cap is proposed.
Gitlink/special-file, status-write, waiver-expiry and UTF-8 items are
captured above rather than accepted merely because the worker listed them.

## Gate and escape-hatch inventory

The following changes require owner visibility before landing:

- Vocabulary registration: AGENTS.md, eslint.rules.js,
  lint-fixtures/src/features/bare-names.ts and test/lint/fixtures.test.ts
  add CloseKinds/Attestations and four values. This corresponds to the
  plan's explicit vocabulary-registration allowance.
- Exact main.ts lint exception and its fixtures, the three permitted
  process members, and ambient declare const/var name handling correspond
  to the dated owner rulings. The process-gate module expansion is only
  partially covered; B16 names the excess.
- node-child-process.d.ts adds the used APIs. bun-spawn.d.ts uses test
  interface merging for execPath. The tsdoc test changes its re-export
  comment, not the enforcement logic.
- Existing tests changed for explicit attribute allowance, pinned/clean
  environment distinctions and identity controls, additional event union
  members, owner-ended settlement/Launched construction, Claude result
  text and the authorized entry/vocabulary fixtures. No removed
  substantive preexisting assertion was identified as an independent
  path to green. New tests nevertheless affirm some wrong behaviors,
  notably zero/non-15 estimates and NotLaunched status.
- No new dependency, lockfile/package-script/CI exemption, production
  bypass flag, inline lint/type suppression, or focused/skipped test was
  identified in the added code. Reviewed type assertions were not found
  as a means to silence a production error. The inherited scanner blind
  spots remain documented rather than treated as proofs.
- Logging close failures with Effect.ignore in state-file publication,
  optional advisory ps evidence, broad last-message read fallback and a
  defect if a matching waived admission refuses are explicit error
  treatment channels. M02 requires narrowing the broad read fallback.

The separate owning-skill lift remains a local handoff until the owner
authorizes writing to that repository. Local approval does not establish
that the external skill has been updated.

## Independent verification

At the exact archived assisted content:

- `gtimeout -k 5 300 bun run docs`: PASS, no warnings.
- `gtimeout -k 5 300 bun run check`: PASS after review-copy Git metadata
  was initialized; 0 blocking findings, 35 advisory notes.
- `gtimeout -k 5 300 bun run test`: PASS on the approved outside-sandbox
  rerun, 1,237 tests in 96 files, 16.25 seconds reported by Vitest.

Failures and setup errors retained:

- The first archive command used Python's unsupported extractall(filter)
  argument and failed with TypeError. A following dependency-copy call
  failed because the tree directory had not been created. The extraction
  was corrected without changing repository source or checks.
- The first check run reached prose, then failed because a tar archive
  has no Git index; the gate correctly refused an empty Markdown list.
  Initializing an isolated Git index in the review copy made the actual
  Markdown inventory available. No gate was weakened.
- The first test run had 13 failures: two readProcesses tests and eleven
  startClient/startClientOver tests, all with EPERM spawning /bin/ps under
  the sandbox. Full raw output is retained in the review directory. The
  sandbox restriction was identified before requesting the required
  escalation; the approved full rerun passed. This was not an unexplained
  pass-on-rerun or a reason to delete tests.
- Clean-environment Git setup printed confstr() warnings about the
  Darwin temporary directory and fell back to /tmp; its commands exited
  successfully. Those warnings were not part of the warning-free docs
  claim.

Bounded no-model probes:

1. Production accepted `{}` Claude settings, a supervisor path below the
   owner checkout, a configured filter attribute line, and all-zero role
   estimates. It created distinct ledger files for two project state
   directories and did not create git-home.
2. With state/git-home/.config/git/attributes set to a local filter and a
   marker-writing clean command in a disposable repository, production's
   attribute check and snapshot passed and the helper marker appeared.
3. Adding candidate `.gitattributes` with `* text` passed the base check
   and raw snapshot; validating the candidate tree itself refused it.
4. Malformed Claude output after success and a malformed Codex error
   event after turn.completed each classified Success.

All helper commands and markers were confined to disposable /private/tmp
repositories. No model or network call occurred. The source and evidence
paths remain in the review directory for the owner to inspect; the isolated
source/dependency copy is retained with the report for inspection. Underlying worker token meters were not available
for independent verification; the execution record remains reported
measurement, not a fresh reading by this reviewer.

## Recommendation and handoff

Correct before landing, pushing or running L3. Keep corrections bounded
in three groups, each with a short explicit scope and failed-first or
isolated-mutant evidence for the listed counterexamples:

1. Production boundaries: B02–B10, with actual factory/CLI integration
   controls for profiles, layout, target identity, candidate attributes,
   HOME, ledger and estimates.
2. Protocol/evidence: B11–B15 and M01–M05, including exact briefs and
   malformed-output handling. Resolve L01 explicitly; do not add process
   signaling or automatic recovery.
3. Offline L3 preparation and gates: B01, B16 and M06; preserve each
   recorded owner exception while narrowing unintended privileges.

B08 and B17 need a concrete snapshot boundary contract and may be split
out of group 1 if necessary; L02 is a disclosed concurrency limit, not
permission to claim adversarial race safety. File-length cleanups and
larger deferred features remain out of scope. After the corrections,
verify the changed boundaries and all required checks, then review the
corrected batch against this finding ledger. Only afterward consider
L3's separately authorized live package and local landing/push decisions.
