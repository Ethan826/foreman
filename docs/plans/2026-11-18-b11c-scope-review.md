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
