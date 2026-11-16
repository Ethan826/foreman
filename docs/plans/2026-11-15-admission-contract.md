# Admission contract review and owner ruling

2026-11-15. Records a focused contract review of design revision 5.2
(commit 642c6f7, not ready) and the owner's ruling on it. Evidence lives in
`research/model/contract-2026-11-15/`. No theorem is approved by anything
here.

## Owner ruling 2026-11-15

- Admission is pacing based on observations, estimates and reservations.
  The design must not claim that admission keeps provider usage below the
  cap or preserves a reserve.
- Conditional-safety analysis stays as research, with its complete
  assumptions listed. A1 and A5 alone must not hide the dependencies on
  A3, A4, clock behavior or owner attestations.
- The next design simplifies around the operational limits: pacing,
  durable accounting, explicit holds and human decisions. It removes any
  implication that freshness proves capture recency, that a reset frees
  accounting room, or that an owner attestation is independently verified
  evidence. The unattended-launch estimates stay prominent.
- The clock helpers, the `bun:ffi` dependency and the signaling procedure
  are proposals, not approved implementation.
- Original evidence that contains absolute paths is preserved as it is.
  Future outputs use normalized paths, with separate redacted copies where
  needed.

## Budget record

The owner capped this pass at 60k tokens, 20 minutes or 30 tool calls,
whichever came first. It used about 86k tokens (a 26k overrun), about 4
minutes and 13 tool calls. Staying under the time and tool-call limits did
not satisfy the budget. The overrun is recorded here and is not
retroactively approved.

## Definitions

| Term | Definition | Clock | check52.py |
|---|---|---|---|
| Capture (as-of) | The moment the provider took the count. Foreman cannot see it: `rate_limits`, `rate_limit_event` and the Codex read carry no as-of time. | Provider time | `Snap`; capture order is the snapshot index `nsnap` |
| Observation | Foreman (stream line, Codex response) or the statusline script receives the reading and records `observedMono`, the boot id and `observedAt`. | `CLOCK_MONOTONIC` plus `kern.bootsessionuuid`; the wall clock for display only | No separate event; folded into `Ingest` |
| Ingestion | The ledger write that gives the reading its `seq`. | Ledger `seq` | `Ingest(idx)`; order is event order |
| Freshness | `nowMono − observedMono ≤ F` (F = 10 minutes), same boot | Monotonic | Boolean `fresh`: any joining `Ingest` sets it, `Stale` clears it |
| Period membership | A later reset time (by more than `resetTolerance`) opens a period, an earlier one is dropped, and anything else joins the current period. | Provider reset time against the Mac wall clock (A4) | `lq`, `lp`, `lpt`; `p_open_period` |

## Text and model mismatches

- M1. Exclusion after `ledger reset`: the text orders by observation
  (`observedMono`), and the model orders by capture (`idx <= lobs`, where
  `lobs = nsnap` at the command). This is blocking finding 1 of the 5.2
  re-review.
- M2. A5: the text constrains only the newest ingested reading, and only
  "while foreman holds a fresh reading", which is circular. The model's
  guard blocks the `Ingest` of any pending reading whose unseen outside use
  exceeds the reserve, which amounts to a provider-side delay bound. This
  is blocking finding 2.
- M3. The model stamps the wall clock at capture (`nsnap − 2·backs`), and
  the text stamps `observedAt` at observation. It is harmless while the
  wall clock decides nothing, but the definitions should match.
- M4. The model merges observation and ingestion. The text has statusline
  observation, then a file, then ingestion. The post-hold rule uses both
  `observedMono` and `seq`, and periods52 does not model that gap.
- M5. The model's owner knows the truth: `LedgerReset` is enabled only
  after a real provider reset, and `Retire` only when the grant really
  used nothing this period. The text has neither precondition.
- M6. The text does not say which clock orders readings against steps in
  the estimate rule. It should be the monotonic clock plus `seq`.

## Assumptions behind any conditional-safety claim (research only)

| Assumption | Kind | Source or enforcement point | What a live test can and cannot show |
|---|---|---|---|
| A1: a step uses at most its estimate | Unverified environmental | Nothing enforces it (no per-run budget in quota units) | Can show how often bracketed steps exceed their estimates; cannot bound future overshoot |
| A2: any reporting delay | Conservative modeling stance | None needed | Nothing to show |
| A3: the count never decreases within a period | Provider behavior, not documented by the vendor (unverified) | Highest-reading rule | Can catch a violation; cannot establish the property |
| A4: provider reset times and the Mac clock agree within `resetTolerance` | Unverified environmental | NTP; period membership | Can measure skew at one time |
| A5 as revision 5.2 states it | Circular: mixes foreman state into an environmental bound | None | Not testable as written |
| A5 on the provider side (not adopted): delay at most D, and outside use in any interval of length F + D at most the reserve | Unverified environmental | None in the design; the model's `Ingest` guard encodes it | Can measure the observed lag from a known request to the reading that shows it; cannot prove a maximum D. The outside-use half depends on the owner's behavior |
| Retirement attestation: retired steps' usage was all counted in an earlier provider period | Owner attestation, not independent evidence | `ledger retire` (the model's `Retire` takes it as true) | Cannot be checked |
| One monotonic clock across processes in one boot | Unverified platform property | The clock helper and FFI call below | Can catch disagreement; cannot prove agreement |
| Usage counted in the period of the request's time | Unverified provider behavior | Needed by any retirement criterion | Partly observable around a reset |
| Readings keep arriving for Claude | Environmental (depends on the owner's use) | None | Observable only |

## Counterexamples and candidate corrections

`fix.py` replays each trace with check52.py's own functions; its output is
`fix-run.txt`.

- T1 (5.2 re-review finding 1): under the written rule a reading captured
  before `ledger reset` but observed after it joins the new period, and TC
  is violated.
- Candidate R1: a period opened by `ledger reset` starts with the highest
  reading, and its freshness stamps, of the readings ingested since the
  last period-opening ingestion; readings ingested after the command join
  as usual. On T1, R1 refuses the launch and TC holds. T1b (an old reading
  without a reset time ingested after the command) launches and TC holds.
  T1c is excluded only by A5. Consequence: `ledger reset` then loosens
  nothing, and only a reading with a later reset time loosens.
- T2 (the PA6 mutant) violates TC under the text's A5.
- T2s (new, reproduced): Snap, Snap, Ingest 2, Stale, Outside, Outside,
  Ingest 1 (same period, joins, refreshes freshness), Run 0, Run 1. The
  unmodified design rules with the text's A5 violate TC (4 > 3). So the
  defect is in the design's freshness rule, not only a misclassified
  mutant. No foreman rule repairs it: without a delay bound, no reading
  shows that it is recent ("refresh only on a non-lower reading" fails
  T2s, where the values are equal).
- Candidate R2: the provider-side A5. It excludes T2 and T2s, and is what
  the model's existing guard already encodes, which is why the model
  passed while the text failed. Not adopted.

Not done: a full periods52 run with R1 and R2, and the reclassification of
PA6 and PA8 that depends on it.

## Clock acquisition (proposal, not approved)

Measured on this Mac with Bun 1.3.6 (`clock-run.txt`):

- In Bun: `bun:ffi` `dlopen` of `/usr/lib/libSystem.B.dylib`, then
  `clock_gettime_nsec_np(6)` (`_CLOCK_MONOTONIC`). Calls after the first
  are effectively free (`mono.ts`).
- In the statusline script: a ten-line C helper (`mono.c`) at about 1.9 ms
  per call including fork, printing the monotonic value and the boot id.
  `python3 -c` costs about 32 ms.
- Boot id: `sysctl -n kern.bootsessionuuid`, read once per process.
- Forbidden for ordering or freshness: `process.hrtime` (it counts from
  about process start under Bun), `performance.now`, `Date` and the
  shell's `date`.
- Agreement across processes is unverified and belongs in L4.

## Retirement and unattended cost

`ledger retire` rests on the owner's word that each retired step's usage
was all counted in an earlier provider period. Without a delay bound, no
sound criterion exists. A candidate under the provider-side A5 exists (an
ingested old-period reading observed at monotonic time t_P implies the
reset came after t_P − D) but is unreviewed and not adopted.

With the Defaults table (five-hour cap 100 − 30 = 70, weekly cap
100 − 40 = 60, estimate 15), a launch needs r + 15n + 15 ≤ cap, where n
counts unretired grants across all projects and periods:

- Five-hour window: n ≤ (55 − r)/15, so at most 4 launches in total until
  a retire, however many periods pass. Within one period, with sequential
  steps whose real use equals the estimate, 2 launches; at half the
  estimate, 3.
- An unattended night: about 2 to 4 Claude launches, mostly in the first
  period.
- Weekly window: n ≤ (45 − r_w)/15, so 4 launches at r_w = 0, 3 at 15, 2
  at 30, none above 45. This applies to a whole weekend, so a weekend
  gets at most 4 Claude launches, and fewer once the owner's own weekly
  use shows.

## Startup signaling (proposal, not approved)

Startup recovery step 1 sends `SIGKILL` to a recorded process group with
no identity check. It needs the same rules as the termination proposal:

- Record the leader's pid, its start time (`proc_pidinfo`
  `PROC_PIDTBSDINFO`) and the boot id in `Launched`, or hold a
  per-operation `flock` marker.
- Never signal a recorded group after a different boot.
- List members with `proc_listpids(PROC_PGRP_ONLY)` and signal each
  verified pid, never `-pgid`.
- When the leader has died and its children were reparented, start-time
  and parent-chain checks cannot succeed; only the marker identifies
  them. Without a marker, report and hold.
- The window between check and signal cannot be closed on macOS. Re-read
  the start time after signaling and report a mismatch, or rely on the
  marker, whose lock vanishes with its holder. The design names this
  race.
- When identity cannot be verified: signal nothing, write an `Uncertain`
  hold, leave the grant open (it keeps counting), and stop `run` until
  the owner records the step as ended. `EndRequested` and `Ended` records
  keep a later startup from signaling the same identity twice.

## Feasibility verdict

The available observations cannot support "no admitted launch takes the
provider's count over the cap" as an operational guarantee. No reading
carries an as-of time or step attribution. TC holds only under A1, which
version 1 cannot enforce, together with a provider-side bound on delay and
outside use that no vendor documents and no live test can establish as a
maximum, and it also depends on A3, A4, the clock behavior and the owner's
retirement attestations. The owner's ruling above follows: admission is
described as pacing.

## Evidence

In `research/model/contract-2026-11-15/`, run from that directory:

- `fix.py`, `fix-run.txt`: `python3 -I fix.py`. Replays T1, T1b, T1c, T2
  and T2s against check52.py, with R1 and R2 substituted.
- `mono.c`, `mono.ts`, `clock-run.txt`: `cc mono.c -o <scratch>/mono` and
  run it twice; `bun mono.ts`; `sysctl -n kern.bootsessionuuid` (the
  value is redacted in the output).

The review's own scratch copies used absolute paths; the copies here use
paths relative to the script.
