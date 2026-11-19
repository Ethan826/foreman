# B11c scope review, 2026-11-18

Verdict: revise the scope before authorizing implementation. B11b's
landed batch can be pushed independently; the B11c scope commit explicitly
does not authorize implementation. Keep the new warning-free docs-build
requirement in AGENTS.md.

Reviewed the B11c scope in 3ed0c25 against the approved design's
"Git environment (E7)" and "No attribute-driven conversion" restriction.
Sources: Git's check-attr and gitattributes manuals, and disposable local
repositories on git 2.50.1 (Apple Git-155). No project source was changed.

## Claims and findings

| ID | Status | Claim | Evidence and conclusion |
|---|---|---|---|
| C1 | VERIFIED, bounded | Explicit --source can read the selected revision despite the clean environment's GIT_ATTR_SOURCE. | Local check-attr probes below returned revision attributes while GIT_ATTR_SOURCE named the empty tree. This part of the proposed mechanism works on the installed git. |
| C2 | CONFIRMED GAP | Explicit unset is harmless when attributes are suppressed. | With `* -text` and local core.autocrlf=true, a regular checkout preserved LF while the empty-attribute-source checkout produced CRLF. Do not grant a blanket allowance for unset or binary on this premise. |
| C3 | CONFIRMED GAP | check-attr over tracked paths reads the declarations required by the design. | A tracked `.gitattributes` containing `future/*.bin filter=mark` yielded only unspecified results for tracked files, but filter=mark for future/new.bin. The existing declaration is invisible to the proposed inventory. |
| C4 | CONFIRMED GAP | An effective unspecified value means no declaration exists. | With `a.txt text` followed by `a.txt !text`, check-attr returned unspecified. It resolves effective values; it does not enumerate declarations or their provenance. |
| C5 | ARGUMENT, not experimentally checked | Protecting attribute-file contents later closes the tracked-path inventory gap. | A new path can match an existing, unchanged declaration. A digest over the attribute file sees no content change. The later digest therefore does not by itself close C3. |

The proposed procedure is finite and uses Git's published parser. Its
representation is narrower than the approved requirement: it observes
effective values only for a finite set of existing paths, after
precedence and overrides. It cannot establish the absence of declarations
for other paths. Strict decoding of its output does not repair that gap.

## Probe inputs and observations

Each probe used a disposable repository, an empty HOME, no inherited
environment, PATH=/usr/bin:/bin, GIT_CONFIG_NOSYSTEM=1 and
GIT_CONFIG_GLOBAL=/dev/null. Git received the hooksPath, fsmonitor and
gpgsign overrides from B11b. Clean queries also set GIT_ATTR_SOURCE to
4b825dc642cb6eb9a060e54bf8d69288fbe24904.

1. Commit `.gitattributes` containing `future/*.bin filter=mark` and a
   tracked a.txt. Feed `git ls-tree -r -z --name-only HEAD` into
   `git check-attr -z --stdin --source HEAD filter text eol ident
   working-tree-encoding`. Every returned value is unspecified. Feed
   `future/new.bin` followed by NUL into the same query: filter is mark.
2. Commit `.gitattributes` containing `* -text` and a.txt containing
   bytes `a\nb\n`. Set repository config core.autocrlf=true. Create two
   detached worktrees from HEAD, one without GIT_ATTR_SOURCE and one
   with the empty tree. The first a.txt contains `a\nb\n`; the second
   contains `a\r\nb\r\n`.
3. Commit `.gitattributes` containing `a.txt text` followed by
   `a.txt !text`. With the clean environment, run
   `git check-attr -z --source HEAD text -- a.txt`: text is unspecified.

These are distinguishing examples, not an exhaustive oracle over Git
attribute syntax or configuration. No custom attribute parser or solver
is proposed by this review.

## Recommendations on the owner's questions

1. Do not blanket-allow explicit unset. Unset and unspecified have
   different Git behavior, and suppression can remove a conversion
   prohibition. Keep a conservative policy until the scope specifies
   which semantics it preserves.
2. Check the base before worktree creation as well as during startup.
   In particular, an info/attributes filter can act during worktree add;
   refusing only afterward is too late. The planned probes must verify
   refusal before the checkout can run a planted filter.
3. Do not accept tracked-only checking on the stated digest rationale.
   Decide whether the rule prohibits declarations for all paths, as the
   approved wording says, or intentionally supports only a narrower
   path inventory. That is an owner decision and design change, not a
   decoder implementation detail.

## Next step

Have Claude revise the scope around these counterexamples before using
the 120k implementation estimate. State the exact contract and attribute
sources, explain how the chosen mechanism establishes that contract, and
make the counterexamples acceptance cases. Check-attr remains useful as
Git's reference for effective attributes, with that narrower claim.

A conservative alternative is to refuse attribute sources entirely for
the first version, rather than distinguish declarations within them.
That avoids a custom parser but also rejects benign uses of attributes;
the owner must choose that compatibility cost explicitly. It is a
proposal, not an approved new restriction. No implementation or
additional worker dispatch is recommended before this scope decision.

References:

- https://git-scm.com/docs/git-check-attr
- https://git-scm.com/docs/gitattributes

## Implementation review of e7e43e3, 2026-11-19

Verdict: corrections required before landing. The existing suite passes,
but two real-repository review probes fail the intended refusal contract.
No shared source file, branch or remote was changed during review.

Fresh baseline on e7e43e3: bun run check passed with 29 advisory notes;
bun run test passed, 57 files and 664 tests; bun run docs built without
warnings. Layer placement is consistent with the project architecture:
Runtime reports reads, Format decodes the tree listing, Features judges,
and Program sequences them. The --full-tree and -t additions are justified
by the scope's whole-revision inventory and rejection of non-blob entries.
Reporting the attribute error after identity conditions pass is acceptable.

### Findings

| ID | Severity | Status | Finding and required correction |
|---|---|---|---|
| B11c-R1 | Important | QUEUED | src/program/worktree.ts:136 reads config from the common directory. It misses core.attributesFile set in the supervisor's config.worktree. Read effective config in the verified supervisor-worktree context at startup, with a real-repository regression test. |
| B11c-R2 | Important | QUEUED | src/program/worktree.ts:105 reads config in the owner's context before creating a different branch/worktree. Conditional includes can activate core.attributesFile only in the destination context. A demonstrated onbranch include bypasses the check and executes a filter during worktree add. Detect or refuse such context-dependent config before creation; a post-add check is too late. A conservative refusal adds a compatibility restriction and needs the owner's scope decision. |
| B11c-R3 | Minor | QUEUED | The new vocabularies in domain/attributes.ts were not added to closedNames. Recommend allowing the required rule and fixture edits. Touching this gate activates the recorded R7 trigger: verify every vocabulary spelling individually, including previously missing path-listed and is-locked, rather than relying on one message for a combined fixture. Do not loosen assertions or add bypasses. |

R1 probe: create a clean supervisor worktree; enable
extensions.worktreeConfig in common config; set core.attributesFile with
git config --worktree from the supervisor path. The common-directory
query exits 1, while the worktree query exits 0. identifyWorktree still
succeeds. git check-attr reports filter=mark. Remove the checked-out a.txt
and restore it with git checkout -- a.txt: the marker filter runs. The
initial attempt to demonstrate checkout used an existing unchanged file
and wrote no marker; removing the file established the triggering path.
The startup-success assertion itself failed in both attempts.

R2 probe: commit a.txt, configure filter.mark.smudge as a marker script,
and write an external attributes file containing *.txt filter=mark.
Write conditional.config with core.attributesFile naming that file, then
set the common config key includeIf.onbranch:foreman/**.path to
conditional.config. In the owner's main branch, the clean config query
exits 1. Production createWorktree nevertheless succeeds on foreman/t
and the marker is written during checkout. The assertion that no marker
should exist fails. This proves that correcting only R1 leaves an earlier
gap in creation.

Both probes ran against disposable repositories in a temporary archive
of e7e43e3. The probe file is outside the shared checkout at
/tmp/foreman-b11c-review.yDoLue/test/program/attribute-review-probe.test.ts.
These are bounded reproductions, not an exhaustive test of conditional
Git config contexts. Gitdir-based conditions should be included in the
correction's acceptance inventory as well as onbranch conditions.

### Answers and correction handoff

- Empty HOME: document the precondition that the caller creates, owns
  and keeps this private directory empty. Do not add another home check
  to B11c. The coverage test intentionally supplies a nonempty test home
  as an observation channel; it is not proof of the production caller's
  ownership or emptiness.
- Lint: recommend the scoped rule update in R3 with its fixture coverage,
  including R7. A brief that forbids config edits does not make the
  vocabulary requirement disappear; the reported conflict now needs a
  bounded owner ruling.
- Conditional config: recommend a conservative pre-creation refusal for
  unsupported conditional includes in this first version, unless the
  owner chooses a destination-context-aware mechanism. Do not silently
  add an override to the clean runner or invent branch-context simulation
  in the correction pass. State the supported config contexts and the
  refusal restriction before implementing the correction.
- The surviving non-regular-entry read mutant does not loosen admission:
  Features still refuses the entry. Record its actual guarantee rather
  than claiming the suite forbids every extra read. No additional test
  is required merely to enforce that optimization.

Integration note: identifyWorktree currently checks WorktreeCreated.base,
the creation revision. Before wiring real startup recovery (B14), the
caller must supply the then-current recorded revision for attribute
checking. The existing gained-attributes test constructs a different
WorktreeCreated.base explicitly; it does not test reconstructing that
revision from the event log. This remains a proposed B14 integration
acceptance item, outside this slice's process/recovery scope.

Independent order mutant: moving the creation check after worktree add
failed 14 tests in test/program (80 cases over 11 files, excluding the
two review probes). This matches the owner's count. The worker's 13-test
count is not reproduced or explained; retain the discrepancy in the
record instead of rewriting it. The mutated file was restored afterward.

Worker consumption, reported by the owner: 222,877 tokens, 76 tool calls,
about 17 minutes versus the 100k estimate. Reviewer usage and owner
verification are outside that measured total. Recommend one fresh,
short-brief correction unit after the config-context scope decision,
then a targeted review of these findings and full validation.
