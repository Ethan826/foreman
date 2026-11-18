# Foreman implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-plan-execution (recommended) or inline-plan-execution to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

2026-11-15. Status: proposed, not approved. Nothing in this plan is
authorized by being written down. Part A restates work the owner already
authorized; Part B needs the owner's approval before any task starts;
Part C waits on a named decision or live test. Live tests that make model
calls need their own approval, given separately for each.

**Goal:** Build foreman, the personal supervisor described by the
approved design, in an order where every task is testable on its own and
the live tests that decide whether unattended use is worthwhile run
first.

**Architecture:** Decision core under a technology shell (skill
`decision-core-architecture`): pure, total Domain and Features; Format
for decoding; Runtime in Effect for SQLite, processes, git, the clock and
notification; Program wires capabilities; the facade is the CLI. State
lives in two SQLite stores (each project's append-only event log, and the
shared usage ledger) and passes through pure folds.

**Tech Stack:** TypeScript 5.9.3, Effect 4.1.4, Bun 1.3.6 (with
`bun:sqlite` once its intake record is approved), Vitest 5.1.0 with
`@effect/vitest`, ESLint house rules in `eslint.rules.js`.

**Spec:** `docs/plans/2026-11-14-agent-supervisor-design.md`, approved at
revision 6.1 (commit a34e28d; see its "Owner ruling 2026-11-15: design
approved"), and `docs/plans/2026-11-15-admission-contract.md` (owner
ruling: admission is pacing; the clock helpers, `bun:ffi` and the
signaling procedure are proposals). Executors read the design section a
task names; the plan does not restate it.

## Global Constraints

- Admission is pacing over foreman's own records. No code, comment, test
  name or doc may claim that admission keeps provider usage below the cap
  or preserves the reserve (admission contract, owner ruling).
- Defaults (design "Defaults"): reserve 30 percent (five-hour) and 40
  percent (weekly); freshness 10 minutes; `initialEstimate` 15 points;
  `busy_timeout` 5 seconds; `resetTolerance` 5 minutes; `dropTolerance` 5
  points; `maxCorrectionRounds` 2; `reviewQueueBound` 1 (2 allowed per
  project); `backlogMax` 3; λ 0.99; `minPairs` 10; `maxRelError` 0.2;
  `capFactor` 1.5; `swapThreshold` 20 points. `readInterval`, `fitLag` and
  `dataVersionPoll` have no value (O3): code takes them as configuration
  with no default and refuses to start a feature that needs one unset.
- Until the owner approves a clock mechanism (O11), Runtime supplies no
  monotonic stamp, no reading is fresh and every launch is Unknown. The
  pure code takes the stamp as `Option` and is complete without O11.
- Startup's unchecked process-group kill is not implemented (owner
  ruling). No code signals a process group recorded by an earlier run.
- No readiness leases (O1) and no cross-instance termination: both are
  deferred.
- Timers and notification timeouts never release a hold, never turn
  Unknown into Allow and never loosen policy.
- Closed vocabularies are named `as const` objects in Domain; no other
  file retypes their strings (AGENTS.md, "Closed vocabularies").
- Inject implementations; never select behavior with a flag.
- No bypass permission flag for either client.
- No lint-disable comments, casts, non-null assertions, skipped tests or
  new allowlist entries. `bun run check` and `bun run test` pass before
  every commit.
- Stage explicit paths only. Commit with the noreply address. Never push
  without the owner's explicit OK for that push.
- Saved live-test outputs use normalized paths: no home-directory path,
  user name or account identifier in any committed file.

## Provenance

Carried from the design's "Provenance of components"; the owner's
approval of revision 6.1 covers each flagged line, with the evidence the
design cites (model checks M3 to M5.2 within their stated bounds, the git
and worktree probes, argument where the claims ledger says so).

- State as a fold over an append-only log: event sourcing (Fowler, 2005). Faithful. Tasks B5, B6.
- Compare-and-append on log position: optimistic concurrency control (Kung and Robinson, 1981). Faithful. Task B5.
- Single-instance lock: `flock(2)`. Faithful. Task B5.
- Intent before effect, reconcile on restart: write-ahead logging (ARIES, 1992). Adapted (no automatic redo of agent steps). Tasks B12, B14, B15.
- Pure decide over events: functional core, imperative shell; decider pattern. Faithful. All Features tasks.
- Per-reason holds, each with its own release: invented composition, flagged, approved with the design; M3 (C1 to C3). Task B6.
- Pacing against windows with a reserve: invented, flagged; claims only a bound over foreman's records. Tasks A2, A3.
- Quota release by a post-hold reading or a waiver: invented, flagged; M3 (C3). Task B6.
- Estimate as maximum of recent measured costs: sliding-window maximum. Faithful. Task A4.
- Waiver bound to the next launch attempt: invented, flagged; M3 (C7). Task B7.
- Shared ledger, admission in one `BEGIN IMMEDIATE` transaction, escrow grants (O'Neil, 1986): adapted; M5.1, M5.2 (LK, ND). Tasks B1 to B3.
- Ledger order by `seq` under the writer lock (ARIES LSN): faithful. Task B1.
- Admission level, reading plus counting grants: escrow accounting, adapted (revision 6.1); argument only, O13 tests in A3. Task A3.
- Periods opened only by a later reset time; timers only tighten: invented, flagged; argument only, O13 tests in A2. Task A2.
- Spend-down ending with its period: invented, flagged; M4, M5 (SD5). Task B7.
- Scheduler order by provider reset time: invented heuristic, flagged; M4 (ED, H1). Task B9.
- Review queue with bound and backpressure: bounded buffer (Dijkstra, 1965). Faithful. Task B8.
- Stacking and unwinding: invented composition, flagged; M4 (QB, UW). Task B8 (bound 2 only).
- Pre-approved backlog: invented, flagged; M4 (BK), M5 (SB, BR). Task B10.
- Drift check, restore, commit through a temporary index and `update-ref` with the old value; worktrees; pinned git directories; environment hardening: faithful use of git, shown by the probes. Task B11.
- Protected-change detection: Tripwire-style digests (Kim and Spafford, 1994). Adapted. Task B11.
- Agent containment by process group: POSIX process groups. Faithful for the in-session kill; startup's kill is replaced by a signal-0 probe (Task B14, a judgment call for the owner).
- Allocations with borrowing ceilings: invented, flagged, no lender protection; M4 (AL). Task B17.
- Rates by recursive least squares (Plackett, 1950; Ljung and Söderström, 1983): faithful for the fit; noise estimate, convergence test and pair selection invented, flagged. Task B17.

## Review Focus

- A reading whose period has no recorded reset time, followed by one that
  has a reset time: the design does not say whether it opens a period.
  Expected: it joins the current period and records the reset time
  (conservative: the reading term cannot fall). Pinned in Task A2.
- Wall-clock jumps (sleep, NTP step, manual change): freshness uses only
  the monotonic stamp in the same boot, and the wall clock may only make a
  reading unusable (`now ≥ resetsAt`). Pinned in Task A3 (a wall clock set
  back an hour never turns Unknown into Allow).
- Two instances racing on one ledger file: one `BEGIN IMMEDIATE` waits up
  to `busy_timeout`, and a timeout launches nothing. Pinned in Task B3
  with two connections to one temporary file.
- A ledger write that fails midway through a settle step: nothing is
  written and the attempt launches nothing. Pinned in Task B3.
- A process group id from an earlier run that now belongs to an unrelated
  process: startup sends no signal and holds. Pinned in Task B14.

---

## Sequence

The parts below group work by what authorizes it. The order to run it
in is:

1. L1 and L2 packages (Part C, C1 and C2), each after the owner approves
   its commands and cost. Their results decide whether unattended
   operation is worthwhile (see "Accounting choices for decision") and
   change Part A's decoder and policy defaults.
2. Part A (authorized), with L1 and L2 results folded in where they
   arrived.
3. The owner's accounting decision (O7 with the choices below) and the
   approval of Part B.
4. Part B in task order. B1 to B10 need no live test. B11 to B16 touch
   git, processes and permissions.
5. L3 after B16 and before any real target repository is used; L4 after
   B14 and B15.
6. Part C items as their decisions arrive.

---

## Part A: work already authorized

Authorized (AGENTS.md): project setup, Domain types, Format decoders and
the pure pacing function, plus docs. What exists at 76c899f:

- Setup: `package.json` with exact pins, lockfile, `tsconfig.json`,
  ESLint house rules with must-fail fixtures, vendored prose linter, CI,
  the onion diagram and its drift test, the stability tripwire.
- Domain: `clients.ts`, `roles.ts`, `ids.ts`, `outcomes.ts`,
  `observation.ts`, `window.ts`, `policy.ts`; `holds.ts` is empty.
- Format: `src/format/claude.ts`, `src/format/codex.ts`, with tests.
- Features: `src/features/pace.ts`, marked provisional. It implements
  revision 3's rule (newest reading by `observedAt`, freshness by wall
  clock, `usedPercent + estimate ≤ 100 − reserve`), not revision 6.1's.

What remains to bring it in line with revision 6.1 (design "Pacing",
"Reconciling readings, grants and charges", "Periods"): four tasks.

### Task A1: Domain types for revision 6.1

**Files:**
- Create: `src/domain/clock.ts`, `src/domain/period.ts`, `src/domain/grant.ts`
- Modify: `src/domain/observation.ts`, `src/domain/policy.ts`, `src/domain/holds.ts`, `src/domain/ids.ts`, `src/domain/README.md`, `eslint.rules.js` (closed-vocabulary string list only, if a new vocabulary's strings must be banned elsewhere)
- Test: `test/domain/clock-period-grant.test.ts`, `test/domain/holds.test.ts`, `test/domain/observation-policy.test.ts`

**Interfaces:**
- Produces:
  - `BootId` (branded non-empty string), `MonoStamp = { bootId: BootId, micros: number }` (non-negative integer microseconds of `CLOCK_MONOTONIC`; microseconds keep uptimes of years inside 2^53).
  - `LedgerSeq` (branded integer ≥ 1), `PeriodSeq` (branded integer ≥ 1), `GrantId` (branded slug).
  - `Observation` gains `observedMono: Option<MonoStamp>` (optional key) and `seq: LedgerSeq`. `observedAt` stays, documented as display only.
  - `GrantPoints = { grantId: GrantId, provider: Client, window: Window, points: number }`: the amount one counting grant adds to one window.
  - `Policy` gains `resetToleranceMillis` (default 5 minutes) and `dropTolerancePoints` (default 5).
  - `HoldKinds` vocabulary (`approval`, `quota`, `uncertain`, `failure`, `drift`, `protected`) and one `Schema.TaggedClass` per hold with the design's payload: `Quota { provider, windows, heldMono: Option<MonoStamp>, ledgerSeq: LedgerSeq }`, `Drift { worktree: WorktreeKind, expected, head, dirty }` with `WorktreeKinds = { Supervisor, Review }`, and the rest as the holds table gives them. `Hold` is their union.
  - `GrantCancelCauses = { LostRace: "lostRace", Orphan: "orphan" }`.

- [ ] **Step 1: Write the failing tests.** Decode round trips for each new type; `Observation` without `observedMono` decodes to `Option.none()`; a `MonoStamp` with negative or fractional `micros` is refused; `defaultPolicy.resetToleranceMillis === 300_000` and `dropTolerancePoints === 5`; each hold class decodes from its encoded form and `HoldKinds` values equal the tags.
- [ ] **Step 2: Run** `bun run test test/domain` and confirm the new tests fail on missing exports.
- [ ] **Step 3: Implement** the types above. Remove the TODO in `holds.ts` and in `observation.ts`. Update the class diagram in `src/domain/README.md` so every class it names is exported (`test/docs/readmes.test.ts`).
- [ ] **Step 4: Run** `bun run check && bun run test`. Expected: PASS.
- [ ] **Step 5: Commit** the files listed above: `feat(domain): types for revision 6.1 pacing, grants and holds`.

### Task A2: Period membership (pure)

**Files:**
- Create: `src/features/periods.ts`
- Test: `test/features/periods.test.ts`

**Interfaces:**
- Consumes: `Observation`, `Policy`, `PeriodSeq` (A1).
- Produces:
  - `WindowPeriod = { periodSeq: PeriodSeq, resetsAt: Option<number>, highest: number, freshest: Option<MonoStamp>, drops: ReadonlyArray<LedgerSeq>, earlier: ReadonlyArray<LedgerSeq> }`
  - `ingestReading(current: Option<WindowPeriod>, reading: Observation, policy: Policy): WindowPeriod`
  - `currentPeriod(readings: ReadonlyArray<Observation>, policy: Policy): Option<WindowPeriod>`: folds one provider-window's readings in `seq` order.

Rules (design "Periods" and the definitions under "Pacing"): the first
reading opens period 1. A reading whose `resetsAt` is later than the
period's by more than `resetTolerance` opens the next period with that
reading as its highest. One earlier by more than `resetTolerance` goes to
`earlier` and changes nothing else. Any other reading joins and can only
raise `highest`; a join lower than `highest` by more than `dropTolerance`
is listed in `drops`. A join with `resetsAt` into a period with none
records the reset time and opens nothing (Review Focus 1). `freshest` is
the joining reading's `observedMono` with the greatest `micros` in the
newest boot seen; a reading without a stamp never sets it.

- [ ] **Step 1: Write the failing tests**, including these property tests (fast-check through `@effect/vitest`, generated readings with `seq` order):
  - `highest` never decreases within one `periodSeq` (C16: a drop opens nothing).
  - Only a later reset time beyond `resetTolerance` increments `periodSeq` (C16).
  - A reading listed in `earlier` never changes `highest`, `periodSeq` or `freshest` (C16: a reading of an earlier period is never used).
  - Example: readings `[30, 10 with the same resetsAt]` give `highest 30` and one drop.
- [ ] **Step 2: Run** `bun run test test/features/periods.test.ts`; expected FAIL (module missing).
- [ ] **Step 3: Implement** with `Arr.reduce`; no other state.
- [ ] **Step 4: Run** `bun run check && bun run test`; expected PASS.
- [ ] **Step 5: Commit** `src/features/periods.ts`, `test/features/periods.test.ts`: `feat(features): period membership for revision 6`.

### Task A3: `pace` and `level` to revision 6.1, with O13's checks of C13 and C22

**Files:**
- Modify: `src/features/pace.ts`, `src/features/README.md`
- Test: `test/features/pace.test.ts` (rewrite), create `test/features/pace-oracle.test.ts`, `test/features/unattended.test.ts`

**Interfaces:**
- Consumes: A1 types, `WindowPeriod` (A2).
- Produces:
  - `level(period: WindowPeriod, counting: ReadonlyArray<GrantPoints>, window: Window): number`: `highest` plus the points of every counting grant for that window. The caller decides which grants count (Task B2); `pace` never filters.
  - `PaceInput = { periods: (window: Window) => Option<WindowPeriod>, now: number, nowMono: Option<MonoStamp>, policy: Policy, provider: Client, estimate: (window: Window) => number, counting: ReadonlyArray<GrantPoints>, cap: (window: Window) => number }`
  - `pace(input: PaceInput): PaceDecision` with `PaceDecision` unchanged (`Allow | Hold | Unknown`, windows in policy order).
  - `defaultCap(policy: Policy, provider: Client): (window: Window) => number`, returning `100 − reserve`. A spend-down's cap arrives through `cap` (Task B7).

Rule: per policy window, usable iff the period exists, `freshest` and
`nowMono` share a boot and `nowMono.micros − freshest.micros ≤ freshness`,
and `resetsAt` is absent or `now < resetsAt`. With `nowMono = none`
nothing is usable (O11). Allow iff every window is usable and
`level + estimate ≤ cap`; Hold if a usable window fails; otherwise
Unknown; a provider with no policy windows is Unknown.

- [ ] **Step 1: Write the failing tests.**
  - Example tests replacing revision 3's: newest-by-`observedAt` no longer decides; a stale reading still raises `highest`; `nowMono = Option.none()` gives Unknown for every window; another boot's stamp is never fresh.
  - `pace-oracle.test.ts` (C13): an independent brute-force oracle written as loops over the raw readings and grants, compared with `pace` on generated inputs (readings with up to three periods, up to six grants, both windows). At least 1,000 runs; the oracle must not import `periods.ts`.
  - Property: raising `now` and `nowMono` with everything else fixed never turns Hold or Unknown into Allow (timers only tighten, C16).
  - Property: setting the wall clock back (smaller `now`, same `nowMono`) never turns Unknown into Allow unless the only failing condition was `now ≥ resetsAt` (Review Focus 2).
  - `unattended.test.ts` (C22), fixtures at the defaults, five-hour cap 70, weekly cap 60, estimate 15: with `r = 0`, `n = 0..3` Allow and `n = 4` Hold on the five-hour window; a fold through three five-hour periods where each step's real use equals the estimate and no grant is retired admits launches 1, 2 in period 1, 3 in period 2, 4 in period 3, and nothing after; at half the estimate, 3 in period 1; weekly: 4 launches at `r_w = 0`, 3 at 15, 2 at 30, 1 at 45, none at 46.
- [ ] **Step 2: Run** `bun run test test/features`; expected FAIL on the new signature.
- [ ] **Step 3: Implement** the signature above. Remove the "provisional" header and rewrite the comment block to cite revision 6.1's rules. Update the flowchart and class diagram in `src/features/README.md`.
- [ ] **Step 4: Run** `bun run check && bun run test`; expected PASS.
- [ ] **Step 5: Commit** the files listed: `feat(features): pace to revision 6.1 with level, oracle and unattended fixtures`.

### Task A4: Estimate per role and window (pure)

**Files:**
- Create: `src/features/estimate.ts`
- Test: `test/features/estimate.test.ts`

**Interfaces:**
- Produces:
  - `StepSpan = { role: Role, startMono: MonoStamp, endMono: MonoStamp }`
  - `measuredIncrease(step: StepSpan, readings: ReadonlyArray<Observation>, window: Window, policy: Policy): Option<number>`: the bracketing rule under "Pacing" (`estimate(window)`): a usable reading observed before the start and one after the end, both with the same `resetsAt`, same boot.
  - `estimate(finished: ReadonlyArray<{ role: Role, increase: (window: Window) => Option<number> }>, role: Role, policy: Policy): (window: Window) => number`: the largest measured increase among the role's last five finished steps, else `initialEstimate`.

- [ ] **Step 1: Write the failing tests:** no measured step gives 15; a bracket across a reset is unmeasured; a bracket from another boot is unmeasured; only the last five of the role count; the sixth-oldest large step is ignored.
- [ ] **Step 2: Run** and confirm FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun run check && bun run test`; PASS.
- [ ] **Step 5: Commit** both files: `feat(features): estimate per role and window`.

Docs for Part A: the orientation docs were updated to revision 6.1 with
this plan; Tasks A1 and A3 update the Domain and Features READMEs.

### Review of Part A and the Claude decoder (2026-11-16)

One independent fresh-context review (Opus, read-only, 12 tool calls,
authorized by the owner with a 100k-token cap) of `653f477..b9b27fe`
under src/ and test/. Verdict: the code matches revision 6.1's rules on
every input traced; nothing blocking; `bun run test` (201) and
`bun run check` pass; no casts, assertions, disables or skipped tests.
Findings 1 to 4 were fixed inline on 2026-11-16 under the owner's
60k-token cap (commits added8c, 867f038 and the oracle commit after them);
nits 5 and 6 stay open. The findings as reported:

1. Should fix. Readings are never filtered by provider:
   `currentPeriod`, `measuredIncrease` (`stampedIn`) and
   `PaceInput.periods` are keyed by window alone, and window names are
   shared across providers. A caller that filters by window only (as
   test/features/fixtures.ts does) would let a Codex reading with a later
   reset time open a Claude period and lower its highest reading, which
   loosens pacing, or bracket a Claude step. No test produces a Codex
   reading. Fix: a provider parameter or filter in all three, and Codex
   readings in the oracle's generator. (Coordinator confirmed against the
   code.)
2. Should fix. Estimate tests miss rules that mutants could break
   unnoticed: the after-reading freshness bound, choosing the latest
   reading before the start and the earliest after the end (every test
   has one candidate per side), and the window filter. Ties on equal
   micros are broken by array position rather than seq. The fixture's
   `beforeAt: -1` gives a negative micros value the schema forbids.
3. Should fix. The C13 oracle compares only the decision name, not the
   window lists, and mirrors periods.ts step by step, so a misreading
   both share would pass. Its generators never reach a now in another
   boot, Codex readings, or non-integer percents and points.
4. Should fix, fails closed. `unifiedWindows` validates every entry, so
   one odd untracked window (for example utilization above 1, unverified
   that it occurs) rejects the whole event and loses both tracked
   readings. Decode the two tracked keys strictly and keep the rest
   opaque.
5. Nit. Hundredth-point percents plus fractional grant points can sum
   just above an exact cap and hold (tightens only); compare in integer
   hundredths.
6. Nit. The estimate requires exactly equal reset times, as the design
   says; Codex-style reset jitter would leave steps unmeasured.

O14 under the implemented rule: a period's reset time is fixed by the
reading that opened it, so drift accumulates against that value. A move
of more than 5 minutes past it opens a period; the observed 21 seconds
does not. If an idle window's reset time rolled forward with the clock, a
period would open every 5 minutes or more while idle. With flat idle use
(0 to 0) nothing changes. If the opening reading were lower than the old
highest (a lagging or cached source), the spurious period would bypass
the keep-the-highest rule and loosen the reading term by at most that
difference; foreman's own grants keep counting, so only outside use
could be under-counted. Unverified: churn of period records and the
interaction with rule P's carry-over test in Task B.

### Found while writing TSDoc (2026-11-16)

The documentation agent recorded these without fixing them:

1. `fresher` in periods.ts lets any stamp from a different boot replace
   the held one. That reads as "newer boot" only if seq order follows
   boot order; a late-ingested reading from an older boot replaces a
   newer stamp. This tightens (the older stamp is not fresh against the
   current boot), but the rule should be stated or changed.
2. `currentPeriod` folds readings in the order given and does not sort by
   seq; seq order is an unenforced precondition on the caller (Task B).
3. `measuredIncrease` requires exactly equal reset times while periods
   allow `resetTolerance`; with reset-time jitter, steps go unmeasured
   (review nit 6).
4. `estimate`'s fallback was not raised to `minEstimatePoints`; being
   fixed under O15 in the skills-and-AGENTS fix pass.
5. Task B6: a Quota hold with an empty `windows` list (a provider with no
   policy windows, Codex by default) would be released vacuously by the
   rule "every window in windows has a post-hold reading that allows".
   B6 must refuse or special-case an empty list.
6. `level` filters grants by window only (a direct caller must pass one
   provider's grants); `defaultCap` returns 100 for an unlisted window.
   `pace` handles both.
7. Codex `usedPercent` and `resetsAt` have no range or unit check; L2's
   app-server read gives Unix seconds by its schema, still to be applied
   in the Codex decoder.

---

## Part B: settled design, implementation needs the owner's approval

Eighteen tasks. Each is testable alone; Runtime tasks test against
temporary SQLite files and disposable git repositories created by the
test, never the owner's repositories and never a model.

Before B1: a dependency-intake record for `bun:sqlite` (built into Bun
1.3.6; no new package) in `docs/dependency-intake.md`, approved with Part B.

### Task B1: Ledger store and `seq`

**Files:** Create `src/domain/ledger.ts` (row types: `Grant`, `Charged`, `GrantCanceled`, `ReadingRow`, `PeriodOpened`, `Reserve`, `Allocation`, `SpendDown`, `SpendDownCanceled`, `Retirement`, `RateUpdated`, each with `seq: LedgerSeq`; capability type `LedgerStore`), `src/runtime/ledger-sqlite.ts`, `src/runtime/README.md` update; test `test/runtime/ledger-sqlite.test.ts`.

**Interfaces:** Produces `LedgerStore = { transact: <A>(body: (tx: LedgerTx) => Effect<A, LedgerError>) => Effect<A, LedgerBusy | LedgerError>, ... }` where `LedgerTx` offers `read(): LedgerSnapshot` and `append(rows): ReadonlyArray<LedgerSeq>`; `openLedger(path: string, busyTimeoutMillis: number): Effect<LedgerStore, LedgerError, Scope>`. WAL mode; every write is one `BEGIN IMMEDIATE`; `seq` from the one-row `ledgerSeq` table; unique keys on `charges.grantId` and `grantCancellations.grantId`, and a grant in at most one of the two (checked in the transaction).

- [ ] Tests first: `seq` is gap-free and totally ordered across tables; a rolled-back transaction leaves no row and no gap; a second charge of one grant is a no-op; charge after cancel is refused; two connections on one temporary file serialize, and a lock held past `busy_timeout` returns `LedgerBusy` with nothing written (Review Focus 3).
- [ ] Run, see FAIL; implement; run `bun run check && bun run test`; commit the listed files: `feat(runtime): shared ledger store with seq ordering`.

### Task B2: Which grants count (pure)

**Files:** Create `src/features/counting.ts`; test `test/features/counting.test.ts`.

**Interfaces:** `RetirementRule = (grant: GrantView, window: Window, snapshot: LedgerSnapshot) => boolean` (true: retired); `ownerOnly: RetirementRule` (retired only by a `Retirement` row covering the grant's `seq`); `counting(snapshot: LedgerSnapshot, provider: Client, rule: RetirementRule): ReadonlyArray<GrantPoints>` (open grants at their estimate, charged at the charged amount, canceled and retired excluded). The rule is injected so the accounting decision ("Accounting choices for decision") changes one value in Program, not a flag.

- [ ] Tests first: canceled grants count nothing; open and charged grants count across periods (C16: a new period frees nothing); a property test that `counting` under `ownerOnly` never drops a grant without a `Retirement` row; grants of every project count.
- [ ] Implement; check and test; commit: `feat(features): counting grants with an injected retirement rule`.

### Task B3: Admission, cancel, charge and settle in the ledger

**Files:** Create `src/features/settle.ts` (pure: `settleActions(log: ProjectLogView, snapshot: LedgerSnapshot, project: ProjectId): ReadonlyArray<SettleAction>` where `SettleAction = CancelOrphan | ChargeFromFinished | ChargeAtEstimate`), `src/runtime/admission.ts` (`admit(store, request: AdmissionRequest): Effect<Admitted | Refused, LedgerBusy | LedgerError>` reads the snapshot, runs `pace` and rule 2 inside one transaction and appends `Grant`; `cancel`, `charge`, `settle`); tests `test/features/settle.test.ts`, `test/runtime/admission.test.ts`.

**Interfaces:** Consumes B1, B2, A3. `AdmissionRequest = { project, opId, provider, estimate per window, nowMono, now, waiverId: Option }`. Charges are always at the estimate (no authoritative measurement exists). Settle runs at every launch attempt (step 2) and at startup (step 5).

- [ ] Tests first (C20, O13 grant lifecycle as fixtures over a recorded event sequence, asserting every intermediate ledger state): orphan grant (no `Intended` names it) is canceled `orphan`; lost race cancels `lostRace` at once; `Finished` without `Charged` is charged once, and a repeated settle is a no-op; a settle whose write fails writes nothing and launches nothing (Review Focus 4); after a successful settle no grant of the project is open except under the startup rule of B14; a property test over generated crash points that no grant is both charged and canceled, none charged twice.
- [ ] Implement; check and test; commit: `feat: grant admission, cancel, charge and settle`.

### Task B4: `ledger settle` (owner command, no signal)

**Files:** `src/features/settle.ts` (add `ownerSettle`), `src/runtime/project-lock.ts` (`tryLock(path): Effect<LockHandle, LockHeld>` with `LOCK_NB`), test `test/runtime/ledger-settle.test.ts`.

- [ ] Tests first: refused while a `run` holds the lock; cancels orphans and charges each `Finished`; an `Intended` without `Finished` stays open and is listed with its recorded pgid; no process is signaled and no git command runs.
- [ ] Implement; check and test; commit: `feat: ledger settle without signaling`.

### Task B5: Project event log, lock and compare-and-append

**Files:** Create `src/domain/events.ts` (the project log's event union: `Intended`, `Launched`, `Finished`, `Committed`, `NothingToCommit`, `CommitRefused`, `CommitFailed`, `Approved`, `Waived`, `Released`, `Adopted`, `Reconciled`, the request and completion events, `ReviewQueued`, `PreApproved`, `Unwound`, `LedgerBound`, `WorktreeIntended`, `WorktreeCreated`, `Rebased`, hold creation events), `src/runtime/project-log.ts` (`append(expectedPosition, events): Effect<Position, PositionMoved>`, `readFrom(position)`), `src/runtime/project-lock.ts` (the `flock` holder); tests `test/domain/events.test.ts`, `test/runtime/project-log.test.ts`.

- [ ] Tests first: decode round trip of every event; an append at a stale position fails with `PositionMoved` and writes nothing; a second lock holder is refused; `LedgerBound` with another path stops startup.
- [ ] Implement; check and test; commit: `feat: project event log with compare-and-append`.

### Task B6: Holds (pure fold and release rules)

**Files:** Create `src/features/holds.ts` (`holdsOf(events): ReadonlyArray<Hold>`, `blocks(hold, provider): boolean`, `quotaReleased(hold: Quota, readings, policy, cap): boolean`); test `test/features/holds.test.ts`.

- [ ] Tests first (C1, C2, C3): each hold is released only by its own event; an approval for another tranche or revision releases nothing; a quota hold blocks only its provider; a reading observed before the hold, or ingested before its `ledgerSeq`, or from another boot never releases it; a passed reset time never releases it (O4 not adopted); a property test that appending clock-only events (none exist in the log; the fold has no time input) cannot change the hold set.
- [ ] Implement; check and test; commit: `feat(features): holds and their release rules`.

### Task B7: Waivers and spend-down

**Files:** `src/features/waiver.ts` (armed waiver: consumed or expired by launch-attempt steps 3 to 7), `src/features/spend-down.ts` (`activeSpendDown(snapshot, provider, window, now): Option<SpendDown>`, `capFor(...)` feeding `PaceInput.cap`); tests beside them.

- [ ] Tests first (C7, C15): a waived launch still takes a grant at its estimate; a waiver expires on any refusal; a spend-down needs a usable reading and none active; a loosening one ends at the period's reset time, a tightening one only at a new period or `--cancel`; rule 2 is skipped only under a loosening one.
- [ ] Implement; check and test; commit: `feat(features): waivers and spend-down`.

### Task B8: Review queue (default bound 1)

**Files:** `src/features/review-queue.ts` (`queueOf(events)`, `implementAllowed(queue, bound): boolean`, `unwindTargets(queue, headOutcome)`); test `test/features/review-queue.test.ts`.

- [ ] Tests first (C17): with bound 1 an implement step launches only on an empty queue and nothing is ever stacked; a correction's commit replaces its tranche's entry at the head; with bound 2, a change request at the head unwinds exactly the tranches above it and re-arms their pre-approvals.
- [ ] Implement; check and test; commit: `feat(features): review queue with bound and unwinding`.

### Task B9: Scheduler (pure)

**Files:** `src/features/schedule.ts`: `schedule(project: ProjectView, ledger: LedgerSnapshot, ctx: ScheduleContext): Launch | HoldQuota | Wait`; test `test/features/schedule.test.ts`.

- [ ] Tests first (C19, H1): candidates ordered by provider reset time of the longest policy window, unknown last, ties to the review; a candidate under a quota hold for its provider is skipped; at most one quota hold per attempt, for the first candidate refused by rule 1; rule-2 refusals create no hold; the correction is the only candidate when rounds remain; `maxCorrectionRounds` 2 ends in `notConverged` (C6).
- [ ] Implement; check and test; commit: `feat(features): scheduler`.

### Task B10: Pre-approved backlog (without `backlog remove`)

**Files:** `src/features/backlog.ts` (`backlogOf(events)`, `approvalFor(tranche, events)`); test beside it.

- [ ] Tests first (C2 revision 4 and 5 parts): `--stop-before` alone never starts its tranche; at most `backlogMax` 3 entries; a discarded implement step's approval is armed again; a passing review creates the approval hold exactly when the next tranche is neither pre-approved nor started.
- [ ] Implement; check and test; commit: `feat(features): pre-approved backlog`.

`backlog remove` waits on O2 (Part C).

### Milestone 1 record (2026-11-17)

Tasks B1 to B10 ran inline on branch `part-b-m1` under the owner's 1M-token
authorization, in the order B1, B2, B5, B3, B4, B6, B7, B8, B10, B9 (see the
rulings). One fresh-context review (Opus, about 132k tokens, 31 tool calls)
read the whole branch; one fix pass followed. Token use for the milestone is
not measurable from inside the session; a rough estimate is 600 to 750k,
unverified. Escape-hatch scan over the branch: none; the one changed config
is `package.json`'s test script (run the suite on the Bun runtime).

Completion lines from the ledger:

- Task B1: complete (commits b4e285e..ae57bad, tests: bun run test →    Duration  2.35s (import 46%, tests 42%, transform 10%, worker 1%))
- Task B2: complete (commits ae57bad..ab6568c, tests: bun run test →    Duration  2.45s (import 46%, tests 42%, transform 11%, worker 1%))
- Task B5: complete (commits ab6568c..a0712ad, tests: bun run test →    Duration  2.83s (import 50%, tests 38%, transform 12%, worker 1%))
- Task B3: complete (commits a0712ad..b9cef71, tests: bun run test →    Duration  3.52s (import 52%, tests 39%, transform 8%, worker 1%))
- Task B4: complete (commits b9cef71..faee335, tests: bun run test →    Duration  2.72s (import 47%, tests 43%, transform 9%, worker 1%))
- Task B6: complete (commits faee335..5dd7e8f, tests: bun run test →    Duration  2.80s (import 48%, tests 42%, transform 9%, worker 1%))
- Task B7: complete (commits 5dd7e8f..99ea1bb, tests: bun run test →    Duration  2.90s (import 49%, tests 41%, transform 9%, worker 1%))
- Task B8: complete (commits 99ea1bb..8dd6f18, tests: bun run test →    Duration  2.94s (import 48%, tests 41%, transform 9%, worker 1%))
- Task B10: complete (commits 8dd6f18..bad1f3e, tests: bun run test →              at least ~264ms faster with isolate: false — reuses workers across files instead of one per file)
- Task B9: complete (commits bad1f3e..5d09390, tests: bun run test →              at least ~254ms faster with isolate: false — reuses workers across files instead of one per file)

Rulings (each with its cost if wrong):

- Ruling: task ids are B1..B10; this skill's task-start/task-brief parse only numeric "Task N" headings, so briefs are extracted by hand from the plan and ledger lines are written in the same format — the committed plan stays unchanged — cost if wrong: none to the code; a resume must read this note.
- Ruling: branch part-b-m1 in the main checkout rather than a worktree — Part A ran on main with the owner's knowledge and nothing else is checked out here — cost if wrong: the owner's checkout sits on the branch until landing.
- - B5 -> B3: B3's settleActions reads ProjectLogView built from B5's events, but B3 precedes B5. Ruling: execute B5 before B3 — order only, no scope change — cost if wrong: none.
- - B4 and B5 both create src/runtime/project-lock.ts. Ruling: B5 creates it (the flock holder), B4 consumes it — cost if wrong: none.
- - B10 -> B9: the scheduler's candidates need approvalFor. Ruling: execute B10 before B9 — cost if wrong: none.
- - B3 says src/runtime/admission.ts runs pace and rule 2, but the lint layer table lets runtime import only domain. Ruling: admission composition goes in src/program/admission.ts (program may import features and runtime); runtime keeps the store — cost if wrong: one file location.
- - B3 says admission runs rule 2, but allocations and the rate fit are B17 (milestone 3). Design: windows are in fallback until rates converge, and in fallback rule 1 alone admits. Ruling: rule 2 is an injected function; milestone 1 supplies the fallback (no rule-2 refusal), named as such — cost if wrong: rule 2 untested until B17.
- B1: Ruling: no Bun type package is installed and tsconfig has types []; declare the bun:sqlite API the store uses in src/runtime/bun-sqlite.d.ts, following test/lint/child-process.d.ts — no new dependency — cost if wrong: a wrong declaration compiles but fails at run time, which the store's tests would show.
- B1: Ruling: rows carry no seq; the snapshot pairs each row with its seq (LedgerEntry), and append returns the seqs written — a row is the same value before and after it is stored — cost if wrong: none to behavior.
- B1: Ruling: LedgerTx.read and append return Effects (append can refuse a charge after a cancel with a typed error) — the plan sketched them as plain returns — cost if wrong: none.
- B1: Ruling: run the test suite on the Bun runtime (`bun --bun vitest run`) — vitest's binary otherwise runs workers on Node 26, which has no bun:sqlite, and Bun has no node:sqlite; foreman runs on Bun, so this is the stricter, more faithful choice; the existing suite passes unchanged under Bun (242/242 before the store's tests) — cost if wrong: a Node-only behavior difference would go unseen, but production is Bun.
- B1: Ruling: the test that holds the write lock from a second connection keeps that helper in the test file, not in src — test-only code stays in tests — cost if wrong: none.
- B5: Ruling: commit outcomes are logged as CommitRecorded(opId, outcome) reusing Domain's CommitOutcome, steps as Finished(opId, outcome, endedAt) reusing StepOutcome, and holds as HoldCreated(hold) — Domain already has classes tagged Committed, NothingToCommit, CommitRefused and CommitFailed, and a second set of identically tagged events would collide — cost if wrong: event names differ from the plan's list, not their content.
- B5: Ruling: the project lock is SQLite's exclusive lock on a dedicated lock file (PRAGMA locking_mode=EXCLUSIVE, BEGIN EXCLUSIVE, busy_timeout 0), held for the run — Bun exposes no flock and the design asks for a non-blocking single-writer lock released when the holder dies; SQLite's unix locks are POSIX fcntl locks the OS drops with the process — published primitive (SQLite locking), not invented — cost if wrong: on a filesystem without POSIX locks the lock would not hold; such filesystems are not supported for the ledger either.
- B5: Ruling: the LedgerBound check is a pure function in src/features/binding.ts — the plan lists only domain and runtime files for B5, but the check is a decision and belongs in Features — cost if wrong: one file location.
- B3: Ruling: SettleAction has CancelOrphan and ChargeFromFinished only; ChargeAtEstimate is for a step startup found ended without Finished (B14, milestone 2) and has no source in this milestone — cost if wrong: one variant added in B14.
- B3: Ruling: rule 2 is the injected AllocationRule; this milestone provides allocationsInFallback (always admits), since every window is in fallback until the rate fit (B17) converges and the design admits by rule 1 alone in fallback — cost if wrong: none until B17.
- B3: Ruling: a waived request is admitted whatever pace says and still takes its grant at its estimate (design C7); arming, consuming and expiring waivers is B7 — cost if wrong: none.
- B4: Ruling: the command that takes the lock, reads the log and writes the settle lives in src/program/ledger-settle.ts with its test in test/program/ — it composes Runtime lock, log and ledger, which only Program may do; the plan named a runtime test file — cost if wrong: file location.
- B6: Ruling: add event ProtectedReleased(accept) — the design's release-protected command has no event in the log, and a hold must be released only by its own event — cost if wrong: one event added.
- B6: Ruling: holdsOf folds the log's own releases; a quota hold's release by readings is quotaReleased, a separate pure check over readings and pacing that the scheduler applies — the log cannot see the ledger — cost if wrong: none; both are pure and tested.
- B6: Ruling: a Quota hold with an empty window list is never released by readings, only by a waiver — closes the vacuous release found while writing TSDoc (plan note 5) — cost if wrong: a provider with no policy windows needs a waiver per launch, which the design already requires (Unknown).
- B7: Ruling: add event WaiverExpired(waiverId), appended by a launch attempt that does not launch a step of the waived provider — the design expires an armed waiver at the next attempt whatever its result, and a refused attempt otherwise leaves no record — cost if wrong: one event.
- B10: Ruling: "the next tranche" for the approval hold after a passing review is the backlog's head entry, or a tranche already started (an implement step intended and not ended or unwound) — the design does not define "next" further — cost if wrong: a hold created or skipped when the owner meant another order.
- B9: Ruling: the scheduler takes an injected admission check (a verdict per candidate, computed by Program from the ledger with pace and the allocation rule) and an injected reset time per provider, rather than the whole LedgerSnapshot — admission's real decision writes a grant in a transaction, and the scheduler stays pure — cost if wrong: Program must compute the verdicts; the race between the check and the real admit refuses at admit and the next attempt tries again.
- B9: Ruling: when the head's last review requested changes and no rounds remain, schedule returns EndNotConverged(tranche) (C6) — the plan's test list names this outcome — cost if wrong: none.
- Final: Ruling: F5 a wall clock set back re-activates a loosening spend-down until a new period — the same rule as pace's now < resetsAt, which the C16 property already allows (setting the clock back loosens only through now < resetsAt) — cost if wrong: a looser cap for the rest of the period after the clock is set back.

Review fixes:

- Final: fixed F1 transaction bracket — test/runtime/sqlite-transaction.test.ts RED→GREEN (missing bracket; :memory: ledger opened), suite green
- Final: fixed F3 waiver applied only to its provider — admission.test "ignores a waiver armed for another provider" RED→GREEN, suite green
- Final: fixed F4 grant points in every policy window — admission.test "records the grant in every policy window pacing checked" RED→GREEN, suite green
- Final: fixed F6 unwind on notConverged and abandon — review-queue.test "also unwinds ... not converged or abandoned" RED→GREEN, suite green
- Final: fixed F9c no second entry for a started tranche — backlog.test "refuses a second entry for a tranche whose approval was used" RED→GREEN, suite green

Deferred minor findings:

- Final: minor (deferred): F2 project lock has no cross-process test; take leaks the handle when BEGIN EXCLUSIVE throws; release skips close if ROLLBACK throws.
- Final: minor (deferred): F7 tests weaker than plan named (settle crash-point property mirrors the rule; busy_timeout wait-then-succeed untested; mid-settle failure only at store level; holds property inserts only Launched).
- Final: minor (deferred): F8 Reconciled must be appended at reconcile completion (B15); RequestCompleted carries no outcome, so a failed restore would release drift (B15).
- Final: minor (deferred): F9a Launch.candidate.role is Schema.String rather than Role; F9b no per-store semaphore on transact.

### Milestone 1 corrections (2026-11-17, owner review)

Done, on branch `part-b-m1`:

- Admission decided in Features: `decideAdmission` in
  `src/features/admission.ts` (waiver for its own provider, pacing, rule 2
  per window); Program's `admit` only reads, writes and wires. This
  supersedes B3's "`src/runtime/admission.ts` runs `pace` and rule 2".
  The cap is computed from the snapshot, spend-downs included; the
  `AdmissionContext.cap` field is gone and `AllocationRule` takes a window.
- F5 (not accepted by analogy): a loosening spend-down whose reset time
  foreman sees passed is ended for good by `SpendDownCanceled(cause
  resetPassed)`, written in the admission transaction; a clock set back
  cannot revive it. `SpendDownCanceled` gains `cause` (vocabulary
  `SpendDownEndCauses`).
- Overlapping `transact` calls on one store failed with "cannot start a
  transaction within a transaction" (established by a test first); each
  ledger store now queues them on a one-permit semaphore. The project log
  has the same semaphore defensively: its append body never yields, so its
  overlap test passes with or without it and is not evidence for it.
- `Launch.role` is the `Role` schema.

Consumption: the original milestone's token use is unknown, estimated
near or beyond the 1M authorization (milestone, review and both
correction passes); it is not certified as within the cap. The owner
authorized a separate 150k tokens on 2026-11-17 for the two remaining
items below, to run in a fresh session; that allowance is accounted
separately. Measured by the harness: the fresh session that did them
used 157,322 tokens (38 tool calls, about 7 minutes), about 7k over the
150k allowance, before the coordinator's own verification. The allowance
was not met.

Remaining, not done (checkpointed for budget; the owner decides):

- F7's planned tests: a crash-sequence property run through the real
  store (generated admit, Intended, Finished, crash and settle
  sequences; no grant both charged and canceled, none charged twice, no
  orphan left after a settle); a store-level test that a batch append
  failing on its second row writes nothing; a `busy_timeout`
  wait-then-succeed test, which needs a second process because a
  synchronous SQLite wait blocks the event loop; a broader holds property
  that inserts every non-release event kind.
- The automated cross-process lock test: a child Bun process holds the
  lock, the parent is refused, the child is killed with SIGKILL, and the
  parent acquires. It needs a small declaration of `Bun.spawn` for the
  tests.

Done in the separate 150k session (2026-11-17), tests only; no
production code changed, because every new test passed against the
existing code. Each test was therefore written after the code and proven
with a mutant in an isolated copy of the repository:

- F7 A1, `test/program/lifecycle-property.test.ts`, "settles each grant at
  most once and leaves open only in-flight steps after a settle": an
  `it.effect.prop` (200 runs, 20 to 40 generated operations, steps 1 to 4,
  projects alpha and beta) over a real SQLite ledger in a temporary
  directory. Operations: `admit`, Intended and Finished appended to the
  project's in-memory log by a live process, `cancelLostRace` before an
  Intended, a crash that drops every write a live process still owed, and
  `applySettle`. Invariants over stored rows: no grant charged twice,
  canceled twice, or both; after a settle of a project, each of its open
  grants was Intended and not Finished in that log. Mutants: settle never
  cancels orphans (fails), settle never charges finished steps (fails),
  the store writes a repeated settle row (fails, at the unique index). The
  minimum length matters: without it the generator rarely reached a
  Finished step and the never-charge mutant survived. No failing seed
  arose against the real code, so none is kept.
- F7 A2, `test/runtime/ledger-sqlite.test.ts`, "writes no row of a batch
  whose second row is refused, the first included". Mutant: the
  transaction commits a failed body (fails, the first row and its seq
  stay).
- F7 A3, same file, "waits within busy_timeout for another process's
  write lock, then writes": a child Bun process
  (`test/runtime/fixtures/hold-ledger-write.ts`) holds BEGIN IMMEDIATE for
  300 ms; the parent's store, opened with a 10 s busy timeout, writes
  after it. Mutant: `busy_timeout=0` (fails with LedgerBusy).
- F7 A4, `test/features/holds.test.ts`: the holds property now inserts
  generated events of all 16 kinds that neither create nor release a
  hold, and a new test checks that creation, release and neutral kinds
  partition `ProjectEvent.members`. Mutants: Intended releases any
  Uncertain hold (property fails); a new unclassified event kind
  (partition test fails).
- B (F2), `test/runtime/project-lock.test.ts`, "refuses while a child
  holds it and is acquired after the child is killed": a child
  (`test/runtime/fixtures/hold-lock.ts`) takes the lock, the parent's
  `tryLock` exits with LockHeld, the test sends SIGKILL, reaps the child
  (signalCode SIGKILL) and acquires. Mutant: `BEGIN` instead of `BEGIN
  EXCLUSIVE` in `tryLock` (fails: the parent acquires while held).
- Support: `test/runtime/child-process.ts` starts a fixture, waits for
  its ready file (bounded, 10 s), and kills with SIGKILL and reaps
  (bounded, 10 s) in a finalizer on every path; `test/runtime/bun-spawn.d.ts`
  declares Bun 1.3.6's `spawn` subset, `process.execPath`/`argv` and
  `import.meta.dirname`, with `exited` typed `PromiseLike` because the
  test lint bans the `Promise` type name; `node-fs.d.ts` gains
  `existsSync` and `writeFileSync`.

Remaining from this session:

- The lock fixture takes SQLite's exclusive lock with the same pragmas as
  `tryLock` rather than calling `tryLock`: the lint lets no test file run
  an Effect (`Effect.runPromise` and `await` are banned under `test/`),
  and the child is an entrypoint. A drift between the fixture and
  `tryLock`'s pragmas would go unseen. The owner decides whether child
  entrypoints get a lint exemption.
- The A1 invariants do not cover cross-project isolation: a mutant that
  lets a settle of one project cancel another project's grants survives
  (it breaks no listed invariant). Adding "a settle of P writes no row
  for a grant of another project" is a one-line invariant, not added
  because it is outside the owner's list.
- F2's other parts (take leaks the handle when BEGIN EXCLUSIVE throws;
  release skips close if ROLLBACK throws) are untested and unfixed.

Interfaces and provenance superseded by milestone 1 (beyond the
corrections above): B1's rows carry no seq (`LedgerEntry` pairs them);
`LedgerTx.read`/`append` return Effects; B4's command lives in
`src/program/ledger-settle.ts`; B5's lock is SQLite's exclusive lock on a
lock file rather than `flock` (published primitive, SQLite locking),
logged commit outcomes are `CommitRecorded` and holds `HoldCreated`, with
new events `ProtectedReleased` and `WaiverExpired`; `PaceInput.periods`
became `PaceInput.readings`; the scheduler takes injected verdicts and
reset times; the test suite runs on the Bun runtime.

### Owner decisions before landing milestone 1 (2026-11-17)

To be done before landing; not started, because the 150k allowance for
the remaining items was already exhausted (157,322 tokens measured). F8
stays with B15.

1. Approved: a narrow lint entrypoint exception for the single named
   lock-child fixture (test/runtime/fixtures/hold-lock.ts), allowing only
   the bootstrap needed to run the real `tryLock`. Its exact path and
   permitted calls are recorded in the lint config; no directory-wide
   exemption. A must-fail fixture shows ordinary tests still cannot use
   those calls. The child must exercise production lock acquisition and
   release, not copied pragmas.
2. Project isolation in the generated-sequence test: a settle for project
   P writes no settlement row for another project's grant. The surviving
   cross-project mutant must be shown to fail.
3. Fix both project-lock handle leaks, with injected-failure tests: a
   failed acquisition closes the opened handle; a failed rollback during
   release still attempts close; cleanup failures stay visible alongside
   the original failure.

No review dispatch, landing or push is authorized by this pass.

Owner authorization, 2026-11-17 (for the three items above):

- 90k tokens total, including verification and records. Target completion
  by 60k; keep the remaining 30k for verification and checkpointing. If the
  remaining work will not fit, checkpoint and return; do not extend the
  allowance.
- One fresh-context agent working inline, with no further delegation. Use
  a harness-enforced token limit if one is available; time and tool-call
  limits do not enforce a token budget (the Agent tool in the 2026-11-17
  session offered none, so the measured usage it reports is the check).
- The previous run used 157,322 tokens against 150,000: 7,322 over budget.
  The new allowance does not retroactively cover that overrun.
- Scope: the lock-child fixture exception, the project-isolation invariant
  and its mutant, and both handle-leak fixes. No landing, push or
  additional review dispatch.

Result (2026-11-17): all three items done on `part-b-m1`, not landed,
pushed or reviewed.

- 66f9265, item 3: `tryLockWith(open)` injects the connection, and
  `tryLock` is `tryLockWith(openSqlite)`. A failed acquisition closes the
  handle, and a failed close becomes a second `ProjectLogError` after the
  original. Release is ROLLBACK `ensuring` close, so both defects stay in
  the cause. The four tests in `test/runtime/project-lock-cleanup.test.ts`
  were seen failing before the fix.
- 82e5686, item 1: `lockChildEntrypoint` in `eslint.rules.js` names
  `test/runtime/fixtures/hold-lock.ts` and permits only `runSync`. The
  child runs the production `tryLock` and releases by closing its scope.
  The must-fail fixtures are an ordinary test calling `runSync`, a sibling
  fixture in the same directory, and `runPromise` at the exempt path. A
  new cross-process test (refused while the child holds the lock, acquired
  after it releases while the child is still running) fails when release
  is mutated to `Effect.void`.
- 560dbb4, item 2: the invariant `settlesOnlyItsProject` in
  `test/program/lifecycle-property.test.ts`. The mutant drops
  `view.grant.project === project` from `isOpenOf` in
  `src/features/settle.ts`; the property then fails with `expected
  { settled: 'g-1', project: 'alpha' } to deeply equal { settled: 'g-1',
  project: 'beta' }`. The mutant was reverted and `git diff` is empty.

Verification by the coordinator after the agent returned: `bun run check`
PASS (exit 0; 0 blocking prose findings), and `bun run test` PASS (40
files, 414 tests). Correction: this record first said the prose gate
reported "one non-blocking finding". That came from reading only the
last line of the log. The gate reports 29 non-blocking notes across 13
files, listed in the landing record below.

Consumption: the harness measured 118,027 tokens for the agent (39 tool
calls, about 5.6 minutes), 28,027 over the 90k allowance. The agent
estimated about 70k, which was wrong, and it did not checkpoint. The
allowance was not met. The coordinator's own use is not included.

Owner direction on budgets (2026-11-17): a self-estimated token allowance
is not an enforceable cap; the agent's 70k estimate was unreliable.
Future delegation uses smaller work units and controls that something
outside the agent enforces, where available, and reports the measured
usage afterward. No budget-control engineering is requested now.

Landing (2026-11-17, owner authorization): milestone 1 landed on `main`
locally by fast-forward from 1524edc to e3d07e0 (27 commits, all with the
noreply author email). The tree was clean and `main` had not diverged.
There is no merge commit and nothing was pushed. On `main`, `bun run
check` and `bun run test` both PASS (40 files, 414 tests), after which
the `part-b-m1` branch was deleted. F8 stays with B15. Not authorized:
push, more review dispatch and Part B milestone 2.

The prose gate's non-blocking notes on `main` (0 blocking): 29 in total.
`README.md` has 3, including the triad at 45:21. `src/domain/README.md`
has 5 triads. `research/live/` has 4: participial clauses in
`l1b-2026-11-16/plan.md` (2) and `l1b-2026-11-16/results.md` (1), and a
caveat shape in `results-2026-11-16.md`. The rest are in `AGENTS.md` (4),
`docs/how-it-works.md` (4), `docs/dependency-intake.md` (3),
`src/features/README.md` (2), and one each in the facade, format, program
and runtime READMEs.

### Task B11: Git and worktree handling

**Files:** `src/runtime/git.ts` (clean git environment with the recorded `GIT_DIR`, `GIT_WORK_TREE`, `GIT_COMMON_DIR` and `-c` overrides), `src/runtime/worktree.ts` (supervisor worktree creation as intent, effect, completion; review worktree `--lock --detach`; startup check), `src/runtime/protected.ts` (digest walk and compare), `src/runtime/commit.ts` (temporary index, `commit-tree` with `Op-Id` trailer, `update-ref HEAD <new> <base>`); tests in `test/runtime/` against repositories the test creates in a temporary directory.

- [ ] Tests first (D, C9 git part, C11, C12): a planted hook, filter, fsmonitor and signing program write no marker file during any shell git command; `update-ref` with a stale base is refused and the owner's branch and checkout are unchanged; the commit ignores the worktree's index; a protected change creates the `Protected` outcome before any git command; the owner's checkout is byte-identical after a full commit cycle.
- [ ] Implement; check and test; commit, one commit per file pair.

#### B11a: create and identify the supervisor worktree (scoped 2026-11-17)

The owner authorized this one slice of B11 on 2026-11-17, not the rest of
B11 or the next milestone. It is also a trial of a different way to
control delegated work.

Deliverable, on branch `b11a-worktree` from `main`:

- Create, following the design's "Supervisor worktree" section: resolve
  `base` (`rev-parse HEAD` in the owner's checkout unless a start
  revision is given), run `git worktree add --lock --reason foreman -b
  foreman/<name> <path> <base>`, then resolve `rev-parse
  --absolute-git-dir --git-common-dir` in the new worktree. Return the
  fields of `WorktreeCreated`. Report an existing branch or path as a
  typed failure, with no cleanup.
- Identify (the startup check): decode `git worktree list --porcelain`
  in Format and decide in Features whether the recorded path is listed on
  `refs/heads/<branch>` and locked. Report which condition failed.
- Focused tests against disposable repositories the tests create in a
  temporary directory. They cover creation, the existing branch, the
  existing path, the owner's checkout unchanged, the identify check
  passing, an unlocked worktree, a different branch, a missing path, and
  decoder cases (including a locked entry with and without a reason).

Excluded: process launching, startup recovery (completing
`WorktreeIntended` without `WorktreeCreated`), appending events to the
project log, the clean git environment and `-c` overrides
(`src/runtime/git.ts`), the review worktree, protected digests, the commit
procedure, and new dependencies.

Control method: one worker invocation, with no delegation and no
automatic follow-up. It stops at completion or at the first scope
conflict and writes a checkpoint (as text to the coordinator) either way.
Its token figure is an estimate (about 60k), not a cap. No deadline is
set, because nothing outside the worker would enforce one. The harness
measures consumption afterward, and the coordinator records it here.

Result (2026-11-17): complete, on `b11a-worktree` (b7f881d, f10a3aa). It
is not landed, pushed or reviewed. The worker stopped at completion with
no scope conflict.

- Domain `src/domain/worktree.ts` (the vocabulary `WorktreeConditions`
  and the typed failures). Format `src/format/worktree-list.ts`
  (`decodeWorktreeList`). Features `src/features/worktree-check.ts`
  (`checkWorktree`, pure, which lists every condition that fails).
  Runtime `src/runtime/worktree.ts` (the injected `RunGit`;
  `createWorktree` uses `execFile` from `node:child_process`, so there is
  no new package). Program `src/program/worktree.ts`
  (`identifyWorktree`).
- Tests: 36 new, in `test/format/`, `test/features/`, `test/program/` and
  `test/runtime/`, against temporary repositories with local config only.
- Coordinator's verification on the branch: `bun run check` PASS (0
  blocking prose findings, the same 29 non-blocking notes as `main`).
  `bun run test` PASS (44 files, 450 tests).

Deviations for the owner to rule on:

1. Creation also resolves `--show-toplevel`. The recorded path is the
   path git lists with symlinks resolved (on macOS `/var` lists as
   `/private/var`). Otherwise a symlinked state directory would fail the
   startup check as "missing path".
2. Runtime returns the raw listing, and Program does the decoding and the
   check, because the layer rules let Runtime import only Domain.
3. Existing branch and path are refused before `worktree add`. This is
   stricter than git, which accepts an empty existing directory. A race
   between the check and the add surfaces as a generic `GitCommandFailed`.
4. The listing is read without `-z`, as the design says, so a path that
   git quotes never matches and fails closed as "missing path".

F9 (found in B11a, open, for B11 drift or B14): the design's startup
check passes when the worktree directory was deleted but its locked
administrative entry remains, because `git worktree list` still lists
the path. A later check (drift or HEAD) has to catch this; none does yet.

Consumption: the harness measured 153,558 tokens (55 tool calls, about
8.7 minutes) against an estimate of about 60k, 2.6 times the estimate.
The coordinator's use is not included. Notes on the trial: the work unit
finished cleanly and stopped where it should, with its deviations named.
The estimate was badly low for a slice of this size: five layers, 36
tests and real-git fixtures. Measured usage, not the estimate, is the
figure to plan from.

Owner rulings on B11a (2026-11-17). The trial improved scope control (one
job, no delegation, a clear stop) and did not validate the effort
estimate. 153,558 tokens is the measured cost of this slice.

1. Canonical path: accepted. Record git's resolved path, and check that it
   identifies the intended worktree and branch.
2. Layering: accepted. Runtime gets the raw output, Format decodes it,
   Features checks it, and Program connects those steps.
3. Prechecks: accepted. Refusing an existing path is a reasonable explicit
   restriction. Keep git's error details when a race defeats the precheck.
4. Quoted paths: fix now with `git worktree list --porcelain -z`. Git
   already gives an unambiguous format, and rejecting valid paths adds an
   unnecessary restriction. This supersedes the design's listing command.
5. F9: fix before landing. A retained git registration does not show that
   the worktree exists. Check that the directory is present and verify its
   git identity before reporting it valid. Keep the locked registration
   and never prune it automatically.

Authorized, as separate work units with measured consumption and no
estimate treated as a cap: the corrections for 4 and 5 with regression
tests, then one fresh-context review of B11a only (layer boundaries and
recorded departures included), with no delegation, no whole-project audit
and no new modeling. No landing or push. If the review clears the slice,
the next decision is local landing.

Coordinator's reading of 1 and 3 against the code: `GitCommandFailed`
already carries `args`, `exitCode` and `stderr`, so 3 holds and needs
a test for the race path only. In 1, creation takes `--show-toplevel`
without checking that it resolves to the requested path or that the
worktree is on the branch. The correction unit adds that check too.

Correction unit, first attempt (2026-11-17): stopped. Nothing was
committed, `src/` is unchanged, and the review has not started.

- What stopped it: a test run of `bun --bun vitest run
  test/features/worktree-check.test.ts`, started after the test was
  edited but before `src/` changed, hung past the 120s tool timeout. The
  worker stopped that run, then tried `pkill -f` on vitest workers, and
  the auto-mode classifier denied it ("Destructive or Unwanted Actions").
  The worker stopped and quoted the denial, as the rules require. No
  vitest process was left running. Why the run hung is not known; a
  failing test should fail, not hang.
- Left uncommitted on `b11a-worktree`: `test/format/worktree-list.test.ts`
  holds the item A tests, rewritten for `-z`. It was seen failing for the
  right reason: 11 cases fail against the newline decoder. The item B
  tests in `test/features/worktree-check.test.ts` are the ones that hung,
  so they have not been seen failing.
- Probe findings (git 2.50.1, Apple Git-155):
  - Without `-z`, git prints worktree paths raw, never quoted. It quotes
    only the lock reason, and a newline in a path splits the record. B11a
    deviation 4 and the decoder's header note are wrong about paths.
  - Creation's single three-value `rev-parse` splits on newlines, so a
    path containing a newline breaks creation too.
  - `rev-parse --absolute-git-dir`, `--path-format=absolute
    --git-common-dir` and `--show-toplevel` resolve symlinks themselves.
- The worker's planned design is in its checkpoint, kept by the
  coordinator. It adds `directory-present` and `git-identity` to
  `WorktreeConditions` and moves `createWorktree` into Program, because
  Runtime may not import Features.
- Consumption, measured by the harness: 104,887 tokens (27 tool calls,
  about 6.5 minutes).

Correction to the record (owner, 2026-11-17): the premise of ruling 4,
that git quotes worktree paths, was wrong. Git prints them raw. The real
failure is a newline in a path, which splits a non-`-z` listing record
and also breaks creation's combined `rev-parse`. Ruling 4 stands: keep
`-z`. The regression tests must use a real path containing a newline and
show both failures, in the listing and in creation.

Hang diagnosis (2026-11-17, coordinator inline, separate from the
corrections):

- Cause, confirmed: the worker's edit to
  `test/features/worktree-check.test.ts` defines the helper
  `const check = (entries, directory = present) => check(entries,
  directory)`. It calls itself where it should call
  `checkWorktree(recorded, entries, directory)`. Bun (1.3.6) runs on
  JavaScriptCore, which does proper tail calls in strict code (ES
  modules), so the self tail call loops forever instead of overflowing
  the stack. Production code was not involved.
- Evidence, from a scratch probe outside the repository: under Bun, `const
  check = (n) => check(n + 1)` ran until a 5-second timeout killed it
  (exit 124). A non-tail version threw `RangeError` at once. Node
  overflowed in about a second.
- Reproduction: `gtimeout -k 5 30 bun run test
  test/features/worktree-check.test.ts`. It printed `RUN v5.1.0` and then
  nothing, and was ended at 30s with exit 124. With the one line
  temporarily corrected, the same command finished in about 1s (exit 1,
  16 tests: 11 pass, and 5 fail on the F9 conditions `src/` does not have
  yet, as expected). The file was then restored byte for byte from a copy,
  and the worker's uncommitted tests are unchanged.
- Cleanup: GNU `timeout` (Homebrew `gtimeout`) makes itself the leader of
  its own process group and, when the limit passes, signals that group
  (`-k 5` sends KILL 5s after TERM). It reaches only processes the command
  started. `pgrep -fl vitest` found none before or after either run. No
  `pkill` and no pattern kill were used, and nothing was denied. For
  later workers, each single-file test run goes through `gtimeout -k 5
  <seconds> bun run test <file>`, with `pgrep` afterward.
- Remaining uncertainty: none for this hang. The diagnosis did not ask
  why vitest's own test timeout did not stop the loop. A synchronous
  infinite loop blocks the worker's event loop, so a timer cannot fire;
  this is expected behavior, but no run checked it separately.
- What the correction worker needs: fix the helper to call
  `checkWorktree(recorded, entries, directory)` as its first step on
  resuming.
- Effort: about 5 shell commands and 37s of test runs in total. The
  coordinator's tokens for inline work are not measured by the harness,
  so no token figure is claimed.

The owner accepted `gtimeout -k 5 <seconds>` as the cancellation
mechanism for these runs (2026-11-17). It is an external timeout over the
run's process group, and the agent harness does not have to own it.
`pgrep` afterward is a diagnostic, not proof of cleanup.

Correction unit, resumed (2026-11-17): complete, f3577b5, on
`b11a-worktree`. It is not landed, pushed or reviewed.

- The recursive helper is fixed. The F9 tests first failed on a schema
  error building the expected value, because the conditions did not exist
  yet. With the Domain vocabulary added first, all 5 failed on their
  assertions.
- A: the listing is read with `--porcelain -z`, and `decodeWorktreeList`
  splits fields at NUL, with records at empty fields. A real worktree
  whose path contains a newline passes the startup check. With the old
  decoder and no `-z`, it fails with `failed: ['path-listed']`. Creation
  reads each `rev-parse` value with its own command (decoders in
  `src/format/rev-parse.ts` strip exactly one newline). A real path
  containing a newline creates correctly. The old combined `rev-parse`
  failed with `GitOutputUndecodable` ("Expected no excess property").
- B (F9): conditions `directory-present` and `git-identity`, read by
  `src/runtime/worktree-directory.ts`. A deleted directory fails Present,
  and the locked registration stays listed. An unrelated directory, or
  another repository, fails Identity. Nothing is pruned, unlocked or
  removed.
- C: `checkCreated` (`src/features/worktree-created.ts`) checks that the
  resolved top level is the requested path with symlinks resolved, and
  that HEAD is `refs/heads/foreman/<name>`. Otherwise it fails with
  `WorktreeNotAsCreated`. Creation moved to Program.
- D: a simulated branch race keeps git's args, exit code and stderr. The
  code was unchanged, and a mutant that drops stderr fails the test.
- The worker's deviations from the planned design: a new `PathUnreadable`
  error (stat or realpath failed on a present path); Runtime split into
  `worktree.ts`, `worktree-directory.ts` and `file-paths.ts` (file-length
  limit); creation's raw-read type `AddedWorktree` in Runtime, with only
  `DirectoryReading` in Domain.
- Gate note, open: `test/lint/fixtures.test.ts` checks only that
  `bare-names.ts` reports at least one closed-vocabulary message. The two
  new must-fail lines are not each asserted.
- Timeouts: none fired. A stray `cat >> /dev/null` in one shell command
  blocked on stdin. The worker stopped that task by its task ID, and no
  pattern kill was used.
- Coordinator's verification: `gtimeout -k 5 300 bun run check` PASS (0
  blocking; 30 non-blocking notes, the new one an and-chain at
  `src/features/README.md:120`). `gtimeout -k 5 300 bun run test` PASS
  (46 files, 487 tests).
- Consumption, measured by the harness: 190,319 tokens (62 tool calls,
  about 13.3 minutes). With the stopped first attempt (104,887), the
  correction work used 295,206 tokens.

Focused review of B11a (2026-11-17, one fresh-context reviewer,
read-only, no delegation): **does not clear the slice for landing yet.**
Every defect found fails closed. None gives a false pass.

Blocking:

- R1, confirmed by the reviewer's probe and again by the coordinator.
  `isDirectory` in `src/runtime/file-paths.ts:18` is `existsSync(path) &&
  statSync(path).isDirectory()`. `existsSync` returns false on EACCES, so
  a worktree under a directory the process cannot search is reported as
  `directory-present`, which is the wrong condition. `PathUnreadable` from
  stat is then reachable only through a race. The recorded departure ("stat
  or realpath failed on a present path") is false for stat, and no test
  exercises `PathUnreadable`. Fix: use `statSync` alone, treat only
  ENOENT and ENOTDIR as absent, and add a test with an unsearchable parent.
- R2, by reading, confirmed by the coordinator: Runtime still decodes and
  decides, against ruling 2, and no departure records it. `ownerHead`
  (`src/runtime/worktree.ts:190-198`) decodes `rev-parse HEAD` in Runtime
  with `String.trim`. `addWorktreeWith` and
  `refuseExistingBranch`/`refuseExistingPath` (116-133 and 200-219)
  interpret exit codes and make the refusal decisions. Fix: move the
  decode to Format and the refusals to Features and Program, or record it
  as a departure for the owner.

Minor:

- R3: the requested path is not required to be absolute, and the
  positional arguments have no `--`. Git resolves the path against the
  owner's checkout, while the prechecks and reads resolve against the
  process's working directory. A relative path could put the worktree
  inside the owner's checkout without being caught, and a leading `-`
  would be parsed as an option.
- R4: `checkWorktree` is not total. `RecordedWorktree` fields are
  `string`, but `WorktreeCheckFailed` requires a non-empty `GitText`, and
  an empty path throws. Program passes a validated `WorktreeCreated`, so
  this cannot happen today.
- R5: the `-z` decoder accepts malformed input. A duplicate `worktree`
  attribute silently drops the first, a record need not start with
  `worktree`, and data after the last terminator is accepted. All of these
  fail closed.
- R6: the docs overstate ruling 3. An empty directory appearing between
  the path precheck and the add is accepted by git, so the stricter
  refusal is bypassed silently. The branch race is tested and correct.
- R7, the gate note: the two new vocabulary names do fire today, but
  `test/lint/fixtures.test.ts:99-101` asserts only one message per
  fixture. Removing a name from `closedNames` would still pass, and
  `path-listed` and `is-locked` have no fixture line. AGENTS.md's
  vocabulary list is out of date (outside the diff).
- R8: tests and identity reads inherit the global git config and
  environment (`core.hooksPath`, `GIT_DIR`), which the clean environment
  in later B11 work covers. One test matches git's English stderr, so it
  depends on locale.

The reviewer ran lint, tsc and the six new test files (all pass; no
timeout fired). It did not rerun the recorded old-code mutants, since the
review was read-only, and did not run the full suite.

Consumption, measured by the harness: 110,779 tokens (20 tool calls,
about 3.9 minutes).

Owner rulings on the review (2026-11-17). B11a has cost 559,543 measured
tokens plus coordination. The next pass closes these acceptance gaps
only. It does not expand the contract or add machinery.

Fix before landing:

- R1: use stat alone, and tell absence apart from permission and other
  I/O failures. Add the reproduced unreadable-parent regression test.
- R2: fix it; no architectural exception. Format decodes, and Features
  makes the semantic refusals. Program performs the reads and connects
  the decisions. Runtime executes operations and reports their results.
- R3: require an absolute destination before any precheck or execution,
  and use git's argument separator where it is supported. Test relative
  and dash-prefixed inputs.
- R4: empty input is a typed refusal, not a throw.
- R6: document the actual restriction. An existing path is refused at
  precheck time, and an empty directory that appears afterward may be
  accepted by git. Add no locking to enforce a stronger promise.

Deferred, each with its trigger:

- R5 (lenient `-z` decoder): before extending the listing decoder or
  claiming strict validation.
- R7 (closed-vocabulary gate): at the next lint-gate change. Until then,
  coverage is incomplete. `test/lint/fixtures.test.ts` asserts only that
  at least one closed-vocabulary message fires for
  `lint-fixtures/src/features/bare-names.ts`, so removing any one name
  from `closedNames` would still pass. `path-listed` and `is-locked` have
  no fixture line, and the vocabulary list in AGENTS.md is out of date.
- R8 (inherited git config and environment, English-message dependence
  in a test): in the next B11 git-environment slice, which also removes
  the dependence on English messages.

Plan: one correction unit, then a targeted check of R1 to R4 and R6 plus
the normal suite. No further review of the whole slice. Existing tests
and findings stay. No landing or push. The unit's consumption is reported
on its own.

Review corrections (2026-11-17): complete, 0cbd879, on `b11a-worktree`.
It is not landed or pushed.

- R1: `statOf` (`src/runtime/file-paths.ts`) uses stat alone. ENOENT and
  ENOTDIR read as absent, and any other error is `PathUnreadable`. The
  startup check and the creation precheck both use it. Regression tests:
  an unsearchable parent gives `PathUnreadable`, not
  `directory-present`, and on creation the add never runs.
- R2: Runtime runs commands and returns raw results (`readOwnerHeadWith`,
  `probeBranchWith`, `addWorktreeWith`, `readAddedWith`). Format decodes
  (`decodeRevParseRevision`). Features makes the refusals
  (`src/features/worktree-precheck.ts`: `requireAbsolute`,
  `refuseExistingBranch`, `refuseExistingPath`). Program sequences the
  absolute check, base, branch probe, stat, add, post-add reads and
  `checkCreated`.
- R3: `requireAbsolute` runs before any git command, and `--` goes
  before the add's positional arguments (git 2.50.1 accepts it,
  confirmed by a real run). Relative and dash-prefixed inputs are refused
  with no git command run, and an absolute path ending in `-worktree` is
  created.
- R4: `RecordedWorktree` is a schema of `GitText` fields, so an empty
  path or branch gives `WorktreeRecordInvalid`, not a throw.
- R6: the TSDoc on `createWorktree`, the precheck header and the READMEs
  state the actual restriction. No locking was added.
- The worker's small deviations: the owner's HEAD is decoded strictly
  (exactly one newline), and there are new Domain errors
  `WorktreePathNotAbsolute` and `WorktreeRecordInvalid` and a schema
  `PathStat`.
- Open, for the owner (the coordinator's targeted check): two small
  semantic choices remain in Runtime, on the startup-check path, which
  the review's R2 did not name. `readDirectoryWith`
  (`src/runtime/worktree-directory.ts`) folds "a file, not a directory"
  into absent, and it turns a non-zero `rev-parse` exit into "no
  identity" (`stdoutOnSuccess`). The behavior is correct, and both fail
  closed. Under ruling R2's wording, Runtime would report the stat result
  and the exit codes, and Features would decide. The worker named both
  and left them, because they were outside its brief.
- Coordinator's targeted check: the R1 to R4 regression tests ran by name
  and passed (53 tests in the four files). `gtimeout -k 5 300 bun run
  check` PASS (0 blocking; the same 30 non-blocking notes).
  `gtimeout -k 5 300 bun run test` PASS (47 files, 509 tests). No timeout
  fired.
- Consumption, measured by the harness: 158,596 tokens (50 tool calls,
  about 7.2 minutes). B11a's measured total is now 718,139 tokens, plus
  coordination.

### Task B12: Step runner (in-session process control)

**Files:** `src/runtime/spawn.ts` (`spawnStep(spec: StepSpec): Effect<RunningStep>`: new process group through Node's `child_process.spawn` with `detached: true`, which calls `setsid`; records the pgid), `src/runtime/classify.ts` (maps decoded Format events and exit status to `StepOutcome`); tests with a fixture script standing in for the client (no model).

- [ ] Tests first: the child is a group leader; on its exit the runner signals that same group once, before reporting `Finished`, and a grandchild `sleep` is gone afterwards; a fixture stream with a `result` error classifies as the matching outcome; an undecodable line is `Unclassified`.
- [ ] Implement; check and test; commit.

Note: Bun reaps the leader when it exits, so the leader's zombie cannot pin the group id; between the leader's exit and the group signal an empty group's id could in principle be reused. This in-session signal is in the approved design (Operations step 3) and is not startup's kill. Owner ruling 2026-11-16: its signaling risk stays unresolved, reviewed with O12; B14's step-ended command does not approve it, and B12 is not implemented until the owner rules on it.

### Task B13: Launch attempt and operations log (Program)

**Files:** `src/program/launch-attempt.ts` (wires steps 1 to 7 of "Launch attempt"), `src/program/run.ts` (the cycle loop); test `test/program/launch-attempt.test.ts` with in-memory fakes for git, spawn and clock built as values.

- [ ] Tests first (C1, C4, C5, C7): no launch with a hold or a request pending; every launch is preceded by `Grant` and `Intended`; a lost compare-and-append cancels the grant at once and decides again; with `nowMono = none` the attempt creates a Quota hold and launches nothing; the full recorded output sequence of a tranche with one correction matches a fixture.
- [ ] Implement; check and test; commit.

### Task B14: Startup recovery without the unchecked kill

**Files:** `src/program/startup.ts`, `src/runtime/process-probe.ts` (`groupExists(pgid): Effect<boolean>` using `process.kill(-pgid, 0)`, which delivers no signal); test `test/program/startup.test.ts`.

What startup does instead of design step 1 (owner ruling: the unchecked
kill is not implemented). For every operation with `Launched` and no
`Finished`:

- It sends no signal. It probes the recorded group with signal 0.
- If no such group exists, the step's processes are gone: step 5 charges
  the grant at its estimate with `endedAt` the probe time, as the design
  says, and step 3 holds the operation `Uncertain` for its git effect.
- If a group with that id exists, startup cannot tell whether it is the
  step or an unrelated process that reused the id. It appends the
  `Uncertain` hold, leaves the grant open (it keeps counting at its
  estimate), reports the opId, the recorded pgid and the members it can
  list, and stops: `run` does not continue. The owner ends the process by
  hand if it is the step's, and starts `run` again; the next startup's
  probe finds the group gone.

Steps 2 to 5 run as the design gives them otherwise.

- [ ] Tests first (C4, C10 as amended, Review Focus 5): a fake probe reporting "exists" leads to an `Uncertain` hold, an open grant, a report naming the pgid, a stopped `run` and no call to any signaling function (the fake records calls); "gone" leads to a charge at the estimate and the hold; a crash between `Grant` and `Intended` is canceled as an orphan.
- [ ] Implement; check and test; commit.

This is a judgment call for the owner: signal 0 sends nothing, but it is a
system call aimed at a recorded id. The alternative is to probe nothing
and always hold, which keeps every crashed step's grant open until the
owner acts.

Owner command `step ended` (owner ruling 2026-11-16). If the recorded
group id has been reused by an unrelated process, the probe keeps
finding it and `run` would stop on every startup. The owner recovers
with `foreman step ended <project> <opId> --grant <grantId>`:

- It appends one attributable record, `StepEndedByOwner(opId, grantId,
  at, by)`, to that project's log under the project's lock, naming the
  exact operation and reservation. It is refused unless that operation
  has `Launched` without `Finished` and that grant is the operation's
  open grant.
- It signals nothing and probes nothing.
- Startup treats the operation as ended: it no longer probes the
  recorded group, so a reused group id no longer stops `run`.
- It is an attestation, not evidence. It does not retire or cancel the
  grant (the grant is charged at its estimate by the settle step and
  then counts until a retire under the rules in force), does not resolve
  the operation's `Uncertain` hold on its repository effect (that still
  needs `reconcile`), does not authorize replaying the step, and does
  not grant any tranche approval.
- [ ] Tests first: refused for an unknown opId, a finished operation, or
  a grant that is not the operation's; accepted once, refused when
  repeated; after it, startup with a fake probe that reports "exists"
  makes no probe call for that operation and `run` continues; the grant
  is charged at its estimate and stays counted; the `Uncertain` hold
  remains; no approval, retire, cancel or replay record is appended; no
  signaling function is called (the fake records calls).

### Task B15: Requests (reconcile, restore, approve --base)

**Files:** `src/features/requests.ts` (pending request fold; stale rule), `src/program/requests.ts` (performs a request as the lock holder); tests beside them.

- [ ] Tests first (D, M3 amendment 8): a request whose HEAD is neither `atHead` nor `target` becomes `RequestStale`; `reconcile` is accepted only for an opId with an `Uncertain` hold; none of the three writes the ledger.
- [ ] Implement; check and test; commit.

### Task B16: Permission profiles, pinned versions, context per step

**Files:** `src/domain/profiles.ts` (editing and read-only profiles as data, per client), `src/format/claude-settings.ts` (encodes the per-step settings file), `src/runtime/client-version.ts` (`--version` check against the configured pin); tests `test/format/claude-settings.test.ts`, `test/runtime/client-version.test.ts`.

- [ ] Tests first (C9 agent part as far as encoding goes, C18): the encoded Claude editing settings deny `git push`, `git commit`, `git config`, web tools and `curl`, deny Edit and Write on the protected set unless the tranche permits, and enable the sandbox with `failIfUnavailable: true`; no encoded command line contains a bypass flag (a must-fail test with each known bypass flag); a version mismatch refuses startup.
- [ ] Implement; check and test; commit. The profiles are unverified until L3.

### Task B17: Allocations, rule 2 and the rate fit

**Files:** `src/features/allocation.ts` (rule 2 and borrowing within ceilings), `src/features/rates.ts` (RLS update with forgetting factor, convergence test, mode per period); tests `test/features/allocation.test.ts`, `test/features/rates.test.ts`.

- [ ] Tests first (C14, C21): rule 2 applies only in ledger mode without a loosening spend-down; an allocation change that would exceed 100 with the reserve is refused; RLS with λ = 1 matches a batch least-squares oracle on generated data within a stated tolerance; mode changes only when a period opens.
- [ ] Implement; check and test; commit.

### Task B18: Alerts and the CLI facade

**Files:** `src/runtime/notifier.ts` (writes to the supervisor log and `status`; an injected capability), `src/facade/cli.ts` (commands: `run`, `status`, `approve [--base]`, `waive`, `release`, `adopt`, `restore [--review]`, `reconcile`, `release-protected [--accept]`, `backlog add`, `spend-down`, `ledger reserve|allocate|settle`); test `test/facade/cli.test.ts`.

- [ ] Tests first: each command decodes its arguments and calls one Program entry with plain data; the facade has no branch on what a value means (review check); a notifier timeout releases nothing.
- [ ] Implement; check and test; commit.

---

## Part C: waits on a decision or a live test

Each item names what it waits on.

### C1: L1 package (Claude usage reading), for approval; front of the sequence

Waits on: the owner's approval of these commands and their cost.

Preparation, no model call: read `claude --help` offline for the
print-mode budget flag's name and unit, and record `claude --version`
for the pin. If `--help` or `--version` is found to contact the network,
stop and report.

Commands (run in a fresh empty directory under a scratch path, so no
project `CLAUDE.md` loads; `$OUT` is a scratch directory outside the
repository):

1. Statusline capture (no extra model call). Add one opt-in line to the
   owner's statusline script that appends its stdin JSON to
   `$OUT/statusline.jsonl`, and leave it in place for one ordinary
   interactive session of the owner's. Remove it afterwards.
2. One stream-json run:
   `claude -p "Reply with the single word: ok" --output-format stream-json --verbose --max-turns 1 > "$OUT/l1-stream.jsonl"`
3. One `/usage` run:
   `claude -p "/usage" --output-format json > "$OUT/l1-usage.json"`

Cap: two `claude -p` calls in total. One retry of a command is allowed
only for a startup failure known to precede provider execution (for
example the client exits with an error before sending any request); an
uncertain outcome is never retried automatically. Cost: one short turn
plus the client's system prompt; "well under one percentage point of the
five-hour window" is an estimate, and the report gives the measured
consumption from the readings before and after each command. `/usage`
is treated as potentially consuming usage until a reading shows
otherwise.

Approved by the owner 2026-11-16, including the temporary statusline
edit: the original script is preserved and restored afterward. Raw
outputs stay private and outside the repository; normalized copies are
inspected before they are committed.

What is captured and where: raw files stay in `$OUT` and are never
committed. Normalized copies go to `research/live/l1-2026-11-XX/`:
`sed` replaces the home directory with `~`, and `jq` deletes
`session_id`, `uuid`, `transcript_path`, `cwd` and any account or email
field. A short `results.md` records the commands, the client version,
and the readings before and after.

Expected evidence and what each result changes:

- `rate_limit_event` appears on an ordinary run and carries, per window,
  a used percent (`usedPercent` or equivalent) and a reset time.
  Foreman's own stream yields usable readings: after O11, sequential
  launches can chain, the accounting ceilings become reachable, and the
  accounting choice matters for unattended use. Task: decode the
  concrete fields in `src/format/claude.ts` and map them to
  `Observation` with source `claudeRateLimitEvent`.
- The event appears but carries only a status (allowed, warning, limited)
  without a percent, or does not appear on an ordinary run. Foreman's
  stream yields no reading. A Claude launch needs a statusline line from
  the owner's own use in the last 10 minutes, so an unattended night gets
  about one Claude launch whatever the accounting choice. Unattended
  Claude work is then not worth building toward unless command 3 says
  otherwise; the decoder records the status only.
- `/usage` returns a usage report and the statusline readings before and
  after it do not move. Claude has a read without a model turn (E2
  changes): a waiting Claude step can ask for a reading on
  `readInterval` (O3), and chaining works even without the event. If the
  bars move, `/usage` is a model turn and is not used.
- The `result` message's `usage` object (token classes) confirms the
  fit's inputs (Task B17); a budget flag found in `--help` and the
  run report's unit decide whether `capFactor` sizing applies.
- Statusline capture shows the `rate_limits` shape for source (b), which
  sets the statusline decoder (C9 below).

Not in this package: the delay and bracket measurements of L1 revision
5.1 (b) and (c). They need several runs bracketed by readings and are
proposed as L1b after the result above, with their own cap.

Result 2026-11-16 (research/live/results-2026-11-16.md): positive.
`rate_limit_event.rate_limit_info.unifiedWindows` gives `utilization` and
`resetsAt` for `five_hour` and `seven_day` on an ordinary run; `/usage`
made no turn and reported zero tokens once (still treated as possibly
consuming); readings have whole-point resolution; the five-hour reading
moved by one point across command 2, which with rounding, delayed
reporting and the owner's concurrent session sets no strict upper bound
on what that call used.

### C2: L2 package (Codex usage windows), for approval; front of the sequence

Approved by the owner 2026-11-16, after the app-server methods are
confirmed offline against official documentation or the installed
client's protocol: one read-only execution and the two quota reads,
using the existing authentication without extracting credentials. Raw
outputs stay private and outside the repository; normalized copies are
inspected before they are committed.

Preparation, no model call: read `codex exec --help` and
`codex app-server --help` offline for a per-run budget option and the
app-server's method list; record `codex --version`. Reading the newest
local session file under the Codex sessions directory for
`rate_limits` entries is free and may already answer the window shapes;
do it first, saving a normalized copy only.

Commands (fresh empty directory, `$OUT` as above):

1. Rate-limit read through the app server, before the run: start
   `codex app-server`, send `initialize`, the `initialized`
   notification and `account/rateLimits/read` as newline-delimited JSON
   on stdin, capture stdout to `$OUT/l2-read-before.jsonl`, then close
   stdin. Confirm the method names in the help output first.
2. One run:
   `codex exec --json --sandbox read-only --skip-git-repo-check "Reply with the single word: ok" > "$OUT/l2-exec.jsonl"`
3. The same read as 1, to `$OUT/l2-read-after.jsonl`.

Cap: one `codex exec` call and two reads. Cost: one short turn, expected
well under one percentage point of Codex's shortest window, unmeasured
until reads 1 and 3 show it. A read is expected to cost nothing; whether
it starts a turn is a question (check for any turn notification and
whether the figures move between reads with no run between them; if
they move, stop).

Captured and normalized as in C1, to `research/live/l2-2026-11-XX/`.

Expected evidence and what each result changes:

- The read returns windows with used percent, window length and reset
  time, and starts no turn. Add the Codex windows to `Windows` and to
  `defaultPolicy` (`src/domain/window.ts`, `src/domain/policy.ts`) with
  reserves the owner sets; Codex launches stop needing a waiver once O11
  is approved. A waiting Codex step can poll on `readInterval` (O3).
- The read starts a turn or costs usage. Read only before a launch, never
  on an interval; Codex waits like Claude.
- `turn.completed` carries token usage. The fit (B17) gets Codex inputs;
  otherwise Codex steps are unmeasured and keep `initialEstimate`.
- Readings without a reset time. O9 becomes a live question.
- Since the default reviewer is Codex, an unattended tranche cycle
  (implement, review, correct) needs both a positive L1 and a usable L2.

Result 2026-11-16 (research/live/results-2026-11-16.md): positive. The
app-server read returns `usedPercent`, `windowDurationMins` (300 and
10,080) and `resetsAt` for both windows and starts no turn; one `codex
exec` moved the primary window from 0 to 1 percent. New question for the
owner (O14): an idle Codex window's reset time appears to roll forward
until usage starts (inferred from two observations), and revision 6.1
opens a period on a reading with a later reset time, so the period rule
needs a decision before the Codex windows enter `defaultPolicy`.

### C3: L3 package (permissions), after B16

Waits on: owner approval; B11 and B16 done. One implement step on a
disposable repository the test creates, with the task list in the
design's L3. Cap: one Claude run (plus one retry on a startup failure).
Cost: one implement-sized step, probably 2 to 10 points of the
five-hour window, unmeasured. Captured: the denied and landed attempts,
marker files, loaded instruction files, `--version`; normalized as in
C1. Result: marks the editing profile verified, or moves `.git/` and
`.claude/` protection to detection only (design "Open items", L3). L3c
and L3r only if a role swap is wanted.

### C4: L4 package (crash and restart), after B13 to B15

Waits on: owner approval; B13 to B15 done. One full cycle in a
disposable repository, killed at each boundary the design lists, with
two projects on one ledger. Cap: about ten short steps across both
clients. Cost: roughly one five-hour window's foreman share on a quiet
day, unmeasured. Result: confirms C4, C10 (as amended by B14), C20 with
real crashes; the reused-pgid startup check confirms B14's hold. The
monotonic-clock agreement check needs O11 first.

### Decision-dependent items

- O1, lender protection: readiness leases. Deferred by the owner's
  ruling; not planned.
- Cross-instance process termination: deferred; not planned. `ledger
  settle` stays signal-free (B4).
- O2, `backlog remove` policy: the command waits.
- O3, `readInterval`, `fitLag`, `dataVersionPoll`: Codex polling,
  `PRAGMA data_version` polling and the fit's pair selection wait for
  values; code takes them as unset configuration.
- O4, release of a quota hold at a passed reset time: not adopted; no
  task unless adopted.
- O5, reflection rule, and the reduced usable share: wait on L1 and L2
  evidence and the owner; they change `RetirementRule` or the level.
- O7 and O8, which charged grants stop counting, and the `ledger retire`
  command's form: see "Accounting choices for decision". The command
  and any automatic rule are a `RetirementRule` value (B2) plus a CLI
  command.
- O9, a provider without reset times: waits on L2.
- O10, `ledger reset` removed: confirm; no task.
- O11, the clock mechanism (`bun:ffi` and the statusline C helper): until
  approved, Runtime supplies `Option.none()` for `nowMono` and every
  launch needs a waiver. After approval: `src/runtime/clock.ts` and the
  statusline helper, with a dependency-intake record for `bun:ffi`.
- O12, startup signaling identity: B14 holds instead of signaling; if the
  owner approves the proposal, startup may end a verified step's
  processes.
- O13: planned in A2, A3, B2, B3 as unit and property tests; no model
  scope.
- C9, statusline decoder for `rate_limits`: waits on C1's capture.
- Role-swap suggestions and swap profiles: wait on L3c and L3r.
- The suggestion statistic, the default `<stateDir>` and branch name: wait
  on the owner.

---

## Accounting choices for decision

The owner's ruling says the restrictive ceilings are not a requirement.
These are the practical choices, at the defaults (five-hour cap 70,
weekly cap 60, estimate 15 on each window, one project, sequential
steps). Every figure below is arithmetic on the admission rule, argument
only, and applies only after O11 (before it, every launch needs a
waiver).

Two facts bound every choice:

- Without a usable reading from foreman's own stream (L1), a Claude
  launch needs a statusline line from the owner's use in the last 10
  minutes, so an unattended night gets about one Claude launch under
  every choice. The choice matters for unattended use only if L1 is
  positive (or `/usage` is a free read).
- The weekly window is usually the binding one. With an estimate of 15
  weekly points per step, every choice that keeps charged grants
  counting until the weekly window resets allows about 4 Claude launches
  per weekly period. Measured weekly estimates (A4) would be far smaller
  than 15, but measuring needs fresh readings that bracket a step, which
  again needs L1.

| Choice | Unattended night (five-hour) | Weekend (weekly) | Assumes | What can go wrong | Live results that move it |
|---|---|---|---|---|---|
| 1. Owner-only retire (the body) | Ceiling 4 launches until a retire, about 2 per period; about 1 in practice pending L1 | At most 4, fewer as the owner's weekly use shows | Nothing about the provider; the owner's attestation is taken on trust | Charged grants pile up and stop all launches until the owner retires them; a careless retire undoes the margin | Positive L1 makes its low ceiling the limiting factor, so less attractive |
| 2. Retire charged grants at a reading with a later reset time | About 2 per five-hour period (3 at half the estimate), so 3 to 6 in an 8-hour night if readings arrive, but the weekly window still stops it at about 4 per weekly period | Unchanged from 1 unless the weekly window resets during the weekend: about 4 per weekly period | A grant that ended before the period opened was counted in the earlier period (the contract's period-of-request assumption, and A6 for early resets) | An early reset or a delayed reading can retire a grant the provider has not counted yet, so the level understates (documented in the contract) | L1 or L2 showing reset times stable and readings near-current makes it more attractive; an observed early reset makes it less |
| 3. Retire after a fixed delay D (a charged grant stops counting once a reading observed at least D after its end exists) | Close to choice 4 when D is short against the step spacing | Close to choice 4 | The provider shows a step's use within D: an unverified environmental assumption no test can prove as a maximum | A step counted later than D is dropped from the level while the reading does not yet show it | L1b delay measurements: a short, consistent lag makes it more attractive; a long or variable lag less |
| 4. Reading plus open grants only (no carry of charged grants) | Limited by real use: `r ≤ 55` per launch, so 4 per period when steps use 15 points, about 12 at 5 points; roughly 6 to 20 a night, within the weekly limit | Limited by real weekly use: `r_w ≤ 45`; 4 at 15 points per step, about 16 at 3 points | Each reading reflects every finished step, which no evidence shows (O5) | A reading taken before a step's use is counted admits one more launch on stale room; repeated, overshoot grows by one estimate per lag | Positive L1 with readings in foreman's own stream after each step makes it more attractive; any observed lag makes it less |

Owner ruling 2026-11-16: the choice is deferred until L1 and L2 report.
Choice 1 is the provisional baseline, not an accepted long-term
usability tradeoff. A positive L1 does not select choice 2: telemetry
being available and evidence that a charge may be retired are separate
questions. The arithmetic in this table is rechecked before the decision
is presented again.

Recommendation (labeled as such; the owner decides). Run L1 and L2
before choosing. If L1 shows no usable reading in foreman's own stream
and `/usage` is not free, keep choice 1: the others buy nothing
unattended. If L1 is positive, adopt choice 2 for the five-hour window as
the first loosening, because its failure mode (an early reset or a late
reading) is bounded to one period and already documented, and measure
the delay (L1b) before considering choice 3. Choice 4 gives the most
throughput but rests on an assumption the admission contract rejects as
evidence. In all cases, B2's injected `RetirementRule` keeps the change
to one value in Program.

---

### Recheck of the arithmetic with positive L1 and L2 (2026-11-16)

Coordinator's arithmetic, argument only, at the defaults (five-hour cap
70, weekly cap 60), sequential steps, readings current. `e` is the
estimate in points per window, `u` a step's real use; under A4 `e`
becomes the largest measured increase of the role's last five steps once
L1-style readings bracket steps, so `e` need not stay 15.

- Positive L1 and L2 remove the "about one Claude launch per night"
  limit: foreman's own steps produce readings, so launches can chain.
  They do not change any retirement rule.
- Choice 1 (owner-only retire): every grant counts until a retire, so
  the total until a retire is about `floor((cap - r) / e)` per window:
  five-hour 4 at e = 15, 14 at 5, 35 at 2; weekly 4 at e_w = 15, 20 at 3.
  Within one five-hour period, readings and grants both rise, giving
  `floor((70 - e) / (u + e)) + 1` launches: 2 at u = e = 15, 7 at 5, 18
  at 2. Measured estimates, not telemetry, set this ceiling.
- Choice 2 (retire at a later reset time): per five-hour period as
  choice 1's within-period figure, repeating each period; the weekly
  window still accumulates for a week, so it binds unless e_w is small.
- Choice 4 (reading plus open grants): per period
  `floor((70 - e) / u) + 1` five-hour launches: 4 at 15, 12 at 5, 28 at
  2, 56 at 1. It relies on each reading including every finished step,
  which nothing shows (O5).
- Whole-point resolution matters now that estimates can be measured: a
  step that uses under one point can measure as 0, and an estimate of 0
  reserves nothing under any choice. Whether estimates need a floor is a
  new owner question (O15). L1 did not measure an implement step's real
  use; L1b would.

Owner rulings 2026-11-16 on these: choice 1 stays through the first
runtime milestone, to be revisited with representative measurements;
choice 4's reflection assumption is not adopted. O15: a one-point minimum
estimate per provider and window for version 1, applied to admission and
reservations alike (Policy `minEstimatePoints`), with observed zero
increases kept in measurement records; it prevents zero reservations and
is not a bound on use. O14: the tolerance-based period rule is accepted
as a pacing heuristic with its possible downward adjustment documented
(src/features/periods.ts); a period change never retires a reservation;
this does not establish Codex's reset semantics.

Owner ruling 2026-11-16: Part A runs now, inline, with a 300k-token
total cap including verification and records, checkpointed before the
cap is reached; no subagent expansion and no Part B implementation.

## Costed handoff

Token figures are rough, worked from the task count and the files each
task reads.

| Part | Work | Approvals needed | Subagent execution | Inline execution |
|---|---|---|---|---|
| A | 4 tasks | Already authorized; the owner reviews this plan | About 13 dispatches, 0.6 to 0.9M tokens, half a day | 1 review dispatch, about 0.3M tokens, 2 to 3 hours |
| B | 18 tasks plus the `bun:sqlite` intake | Approval of Part B (in milestones: B1 to B10 pure and ledger; B11 to B16 git, processes, permissions; B17 and B18) and the accounting decision before B2's rule is wired | About 55 dispatches, 3 to 5M tokens, 3 to 5 working days | Not recommended in one session; per milestone about 1M tokens and 1 review dispatch |
| C1, C2 | L1 and L2 packages | Each: the owner's approval of commands and cost | 1 agent each, about 50k tokens; 2 Claude calls and 1 Codex call plus 2 free reads | Same |
| C3, C4 | L3 and L4 | Each: owner approval after its prerequisite tasks | 1 agent each, 100 to 200k tokens; one implement step (L3), about ten short steps (L4) | Same |
| C, decisions | O1 to O13 items | The owner's decision on each | Sized when decided | |

Recommended: subagent execution for Part B (many tasks with shared
interfaces, and a mistake in the ledger or recovery is costly);
inline for Part A (four small pure tasks). Part B's spend is substantial
and needs an explicit yes.
