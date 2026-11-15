"""AMENDMENT 8 (monitor only, after mutant GL1 stopped with an error: the
monitor ignored a launch output at a failed settle write and then failed
on the step's Intended). The monitor now records such a launch and checks
AS for it. The unmutated model never launches at a failed settle write,
so its results are unchanged; scope leaks52 was rerun to confirm.

AMENDMENT 7 (after the second leaks52 run under amendment 6: 885,264
states, no violations, strict liveness 0; that run modeled `ledger
settle` killing the down project's process groups, which the owner has
not approved). Change, fixed before the third leaks52 run: `ledger
settle` (and its failed form) kills nothing, cancels orphans and charges
each Finished without Charged; an Intended without Finished stays open,
counted at its estimate, until the project's next startup. LK after
`ledger settle` therefore allows exactly those grants to stay open. The
second run's result is kept in check52-run.txt as the result for the
cross-instance termination proposal's settle rule, not for the body.

AMENDMENT 6 (after the first run of scope leaks52: stopped by hand at
45 s with 700,000 states, the frontier at 481,788 and growing, and 3.0
GB resident). Changes, fixed before the second leaks52 run: (a) no Spend
event (steps use no units; scope leaks52 checks the grant lifecycle, and
AS there reduces to "no grant charged while its process may still run",
which needs no units); (b) only project 1 can lose a race (as in M5.1).
What leaks52 no longer covers: a process spending after its instance
crashed (M5.1 covers it with one operation per project), and project 0
losing a race.

AMENDMENT 5 (after run 5, scope periods52 under amendment 4:
1,666,388 states, one TC violation, 3,044 liveness deadlocks; output
kept in check52-run.txt). (a) The TC trace is a design defect: after a
reset foreman had ingested a reading of the new provider period (2
units); the owner's `ledger reset` then opened a period with no reading,
and a delayed, older reading of the same provider period (1 unit) joined
it and became its highest, so foreman spent the reserve on outside use a
reading had already shown. Design change (revision 5.2, "Periods"): a
reading observed (monotonic clock) before a `ledger reset` never joins
the period it opens; the model compares snapshot indices, which stand
for observation order. (b) The deadlocks are model artifacts: a snapshot
that A5 keeps from arriving stayed pending, so the state was never
marked bounded although no reading could arrive. A state is now bounded
when no snapshot is left and no pending one can be ingested. Fixed
before run 6.

AMENDMENT 4 (after run 4, scope periods52 under amendment 3:
1,735,094 states, liveness 0, one TC violation; output kept in
check52-run.txt). Trace: a snapshot of 0; two outside units; foreman
ingests the snapshot (now fresh, with 2 unseen units, more than the
reserve); project 0 launches (level 1, within the cap 2), project 1
launches (level 2); the provider's total can reach 4 > U = 3. The model
enforced A5 only for outside use after ingestion, so a delayed reading
(A2) could arrive already older than A5 allows. That is the design's
gap, not the model's: under A2's unbounded delay, freshness measured
from observation does not bound the outside use a reading misses. The
design now states A5 as an assumption on the reading's as-of moment
(see "Reconciling readings, grants and charges"). Change, fixed before
run 5: Ingest of a snapshot is enabled only while the outside use
counted after it is at most the reserve (A5 in full); --no-a5 restores
run 4's grammar and shows the violation, as --overshoot does for A1.

AMENDMENT 3 (after run 3, scope periods52 under amendment 2: stopped
by hand at 41 s with 1,200,000 states, the frontier at 782,671, and 3.1
GB resident). Changes, fixed before run 4: (a) no ClockPass event (a
late reset or a forward clock step only makes readings unusable, which
tightens; argued, not modeled); (b) the search keeps no copy of each
model state (a deadlock is reported by its trace) and keeps edges in
integer arrays; the search's results are unchanged by (b). What
periods52 no longer covers: a late reset and a forward clock step.

AMENDMENT 2 (after run 2, scope periods52 under amendment 1: stopped
by hand at 45 s with 900,000 states, the frontier at 1,511,440 and
growing, and 4.8 GB resident). Change, fixed before run 3: at most 2
snapshots (it was 3), both of which may be pending at once, so either
can be ingested first. What periods52 no longer covers: a third reading,
so a launch after a reading goes stale needs one of the two snapshots
still pending, and a reading on each side of the reset plus a later
fresh one cannot all occur in one run.

AMENDMENT 1 (after run 1, scope periods52: stopped by hand at about
180 s with the process at 3.7 GB resident on a shared machine, over the
2 GB limit; no result read). Changes, fixed before run 2: (a) project 0
has 1 operation (it had 2), so periods52 has 2 launches in all; scope
leaks52 keeps 2 operations per project; (b) at most 2 outside units
(reserve + 1; it was 3), still enough for an Unknown-as-Allow launch to
break TC; (c) the wall stamp is no longer a state variable: a snapshot's
stamp is its index, minus 2 if it was taken after the ClockBack. What
periods52 no longer covers: a project's second launch against its own
carried charge (project 1 still launches against project 0's), and
outside use of reserve + 2 (so a mutant that ignores freshness can be
missed by TC; see the mutation results).

Model check M5.2: the revision-5.2 ledger rules of the agent supervisor
design (docs/plans/2026-11-14-agent-supervisor-design.md, revision 5.2).
check4.py, check5.py and check51.py and their outputs are kept unchanged.
The grants code of check51.py was copied as a start for scope leaks52;
scope periods52 is new. Scopes stages5 and queue5 are not part of this
file: their rules are unchanged in revision 5.2 and M5.1's runs stand. A
passing run supports only the rules modeled here, within the grammar and
bounds below. Usage: python3 -I check52.py periods52|leaks52 [--stop]

GRAMMAR AND BOUNDS (fixed before the first run; amendments, if any, are
added above this header, labeled with before and after results).

House style as in M4, M5 and M5.1: a pure decide(s, ev) -> (s, out); a
monitor check(m, ev, out) that never sees model state; BFS over (model,
monitor) states; liveness by backward reachability; counters. Every
violation tag here is a property computed from the monitor's own record
of environment events; scope periods52 has no restatement check, and
scope leaks52 keeps M5.1's K and DC restatements (reported under those
tags, and ignored when a mutant is classified; mutate52.py runs leaks52
with --safety-only).

=== Scope "periods52" (period accounting; owner requirement 2) ===

One provider, one window. Projects 0 and 1 share the account; project 0
has 2 operations, project 1 has 1. Integer units: U = 3, reserve 1,
cap 2, estimate EST = 1. A step uses at most EST (assumption A1); a
launched step starts at once and is charged at EST when it finishes
(the grant lifecycle's failure paths are scope leaks52's subject).

Provider (truth). Provider period pp, its counted use tu. The wall
clock's position is clk: the clock has passed the scheduled reset time
R_q of every provider period q < clk.
  Reset         the provider resets on schedule: the clock passes R_pp,
                then pp + 1 (at most 1 reset in all, this or EarlyReset).
  EarlyReset    the provider resets before R_pp; the clock has not
                passed it.
  ClockPass     the clock passes R_pp before the provider resets (a late
                reset, or a forward clock step); at most 1.
  ClockBack     the wall clock steps backward: clk - 1 (floor 0), and
                the wall stamp of later snapshots falls by 2; at most 1.
  Outside       one unit of the owner's own use, at most 3 in all
                (reserve + 2). Assumption A5 (the reserve's job): while
                foreman holds a fresh reading, the outside use counted
                after the newest snapshot foreman has ingested is at
                most the reserve; Outside is disabled when it would
                exceed that. With no fresh reading it is unbounded
                (within the 3).
  Snap(hasR)    the provider's count is captured as a reading (pp, tu),
                with or without a reset time, stamped with the wall
                clock; at most 3 snapshots, at most 2 pending.
  Ingest(idx)   foreman ingests any pending snapshot, so readings arrive
                delayed and out of order (A2).
  Stale         every reading foreman holds ages past freshness
                (freshness on the monotonic clock; ClockBack does not
                undo it).

Foreman (revision 5.2 as written).
  Membership: a reading with a reset time later than the ledger
  period's opens a new ledger period; one with an earlier reset time is
  dropped; any other reading, with or without a reset time, joins the
  current ledger period. A usage drop opens nothing.
  Reading used: the highest usedPercent among the ledger period's
  readings (fresh or not). Usable: some reading of the period, a fresh
  one ingested since the last Stale, and the clock has not passed the
  period's recorded reset time.
  Level: that reading plus EST for every grant not canceled or retired
  (rule P of revision 5.2).
  Run(j)        launch iff usable and level + EST <= cap; else refuse.
  Spend(g), Finish(g) (Charged at EST).
  Retire(g)     owner command `ledger retire`: enabled only for a
                charged grant that used nothing in the provider's current
                period (the owner's attestation is taken as true here).
  LedgerReset   owner command: enabled only after a provider reset since
                the ledger period opened; opens a period with no reading.

Property TC (provider's total count; owner requirement 2): at every
launch, tu + (what each running step can still use) + EST <= cap +
min(unseen, reserve), where unseen is the outside use of the provider's
current period counted after the newest snapshot foreman has ingested
(all of the period's outside use if that snapshot is of an earlier
period; 0 if foreman has ingested none). With unseen at most the
reserve this says the provider's total count stays within U.
Liveness: from every expanded state a launch, an owner Retire or
LedgerReset, or the end is reachable; states with no snapshot left get
credit (no reading can arrive).

=== Scope "leaks52" (accumulating leaks; owner requirement 3) ===

M5.1's scope grants51 code with: 2 operations per project; both
projects race (at most 1 each), crash at any point (at most 1 each),
fail a cancel or charge write (at most 1 each), and fail the settle
step's own ledger write (RunSF, StartSF, LedgerSettleSF; at most 1 each:
nothing is written, the attempt or startup ends; a failed startup or
ledger settle has killed the process groups first); U = 5, reserve 1,
cap 4, so all four operations fit; no outside use, no reset, one usable
reading of 0 from the start (no Snap, Ingest or Stale). Rule P is
revision 5.2's (every grant not canceled counts). Properties AS, LK, ND
as in M5.1; LK is checked after every settle step that succeeds.
"""
from collections import deque
from array import array
import sys, time

SCOPE = next((a for a in sys.argv[1:] if a in ("leaks52", "periods52")), "periods52")
OVERSHOOT = "--overshoot" in sys.argv          # assumption A1 dropped: project 0's steps may cost EST + 1
SAFETY_ONLY = "--safety-only" in sys.argv
NO_A5 = "--no-a5" in sys.argv                  # periods52: assumption A5 dropped (amendment 4)      # restatement checks (tags DC, K, UK) are not reported


def tset(tup, i, v):
    l = list(tup); l[i] = v; return tuple(l)


# =================================================================
# Scope "grants51": provider truth modeled apart from the ledger
# =================================================================
G_PROJ = (0, 1); G_OPS = (2, 2); G_U = 5; G_RES = 1; G_CAP = G_U - G_RES; EST = 1   # leaks52: two operations per project
G_MAXC = (0, 0)   # amendment 6: no Spend event in leaks52 (was (EST, EST))
G_OUT_MAX = 0; G_RESET_MAX = 0   # leaks52: no outside use, no reset, one fixed usable reading of 0
G_RACE_MAX = (0, 1); G_CRASH_MAX = (1, 1); G_WFAIL_MAX = (1, 1); G_SFAIL_MAX = (1, 1)
G_CHARGEFAIL = (True, True)
# Ledger row: (project, op, issue ledger period, status o/c/x, provider period at end or None,
#              process alive, units spent)
J, OP, LP, ST, FPP, ALIVE, SPENT = range(7)


def g_initial():
    return dict(up=(True, True), ph=(None, None), log=tuple((None,) * n for n in G_OPS), uh=(False, False),
                qh=(False, False), led=(),
                pp=0, tu=0, out=0,                  # provider: period, counted use, outside use this period
                pend=None,                           # a snapshot taken but not yet ingested: (pp, tu)
                rd=(0, 0), rok=True,                 # leaks52: one usable reading of 0, ingested before the start
                lp=0, lpp=0, plpp=-1,                # ledger period, its provider period, the previous one's
                resets=0, outs=0, races=(0, 0), crashes=(0, 0), wfails=(0, 0), sfails=(0, 0))


def g_counts(s, r):
    """Rule P: a grant counts in the current ledger period when it was issued in it, is still open,
    or was charged with an end not provably before the previous period's reset time."""
    return r[ST] != "x"   # rule P (5.2): every grant not canceled counts (leaks52 has no retirement)


def g_usable(s):
    return s["rd"] is not None and s["rok"] and s["rd"][0] == s["pp"] and s["rd"][0] == s["lpp"]


def g_level(s):
    return s["rd"][1] + sum(EST for r in s["led"] if g_counts(s, r))


def g_allows(s): return g_usable(s) and g_level(s) + EST <= G_CAP


def g_row(s, g, **kw):
    r = list(s["led"][g])
    for k, v in kw.items(): r[{"st": ST, "fpp": FPP, "alive": ALIVE, "spent": SPENT}[k]] = v
    s["led"] = tset(s["led"], g, tuple(r))


def g_kill(s, j, out):
    for g, r in enumerate(s["led"]):
        if r[J] == j and r[ALIVE]:
            g_row(s, g, alive=False, fpp=s["pp"]); out.append(("killed", g))


def g_settle(s, j, out, kill):
    """Settle step: cancel grants no Intended names (by grantId); charge Finished-without-Charged; when
    `kill` (startup, ledger settle) also charge Intended-without-Finished at EST after the kill."""
    if kill: g_kill(s, j, out)
    named = {e[1] for e in s["log"][j] if e is not None}
    for g, r in enumerate(s["led"]):
        if r[J] == j and r[ST] == "o" and g not in named:
            g_row(s, g, st="x"); out.append(("cancel", g))
    for e in s["log"][j]:
        if e is None or s["led"][e[1]][ST] != "o": continue
        if e[0] == "F" or (kill and e[0] == "I"):
            g_row(s, e[1], st="c"); out.append(("charge", e[1], EST))


def g_release(s, out):
    for j in G_PROJ:
        if s["qh"][j] and g_allows(s):
            s["qh"] = tset(s["qh"], j, False); out.append(("release", "quota", j))


def g_left(s, j): return sum(1 for e in s["log"][j] if e is None)


def g_decide(s, ev):
    s = dict(s); out = []; k = ev[0]
    if k in ("RunSF", "StartSF", "LedgerSettleSF"):   # the settle step's own ledger write fails
        j = ev[1]; s["sfails"] = tset(s["sfails"], j, s["sfails"][j] + 1)
        if k == "StartSF": g_kill(s, j, out)
        return s, out + [("settlefail", j)]
    if k == "Run":
        j = ev[1]
        g_settle(s, j, out, False)
        if s["uh"][j] or s["qh"][j]:
            out.append(("refuse",)); return s, out
        if g_left(s, j) == 0:
            return s, out
        if g_allows(s):
            op = next(i for i, e in enumerate(s["log"][j]) if e is None)
            g = len(s["led"])
            s["led"] = s["led"] + ((j, op, s["lp"], "o", None, False, 0),)
            s["ph"] = tset(s["ph"], j, ("g", g))
            out.append(("launch", j, g)); return s, out
        s["qh"] = tset(s["qh"], j, True); out.append(("hold", "quota", j)); return s, out
    if k in ("Intend", "Race", "CancelLost", "CancelFail", "Finish", "Charge", "ChargeFail"):
        j = ev[1]; ph, g = s["ph"][j]; op = s["led"][g][OP]
        if k == "Intend":
            s["log"] = tset(s["log"], j, tset(s["log"][j], op, ("I", g)))
            g_row(s, g, alive=True)
            s["ph"] = tset(s["ph"], j, ("r", g)); return s, [("intended", j, g)]
        if k == "Race":
            s["races"] = tset(s["races"], j, s["races"][j] + 1)
            s["ph"] = tset(s["ph"], j, ("l", g)); return s, []
        if k == "CancelLost":
            g_row(s, g, st="x"); s["ph"] = tset(s["ph"], j, None); return s, [("cancel", g)]
        if k in ("CancelFail", "ChargeFail"):   # write timeout: the attempt ends, the grant stays open
            s["wfails"] = tset(s["wfails"], j, s["wfails"][j] + 1)
            s["ph"] = tset(s["ph"], j, None); return s, []
        if k == "Finish":
            s["log"] = tset(s["log"], j, tset(s["log"][j], op, ("F", g)))
            g_row(s, g, alive=False, fpp=s["pp"])
            s["ph"] = tset(s["ph"], j, ("f", g)); return s, [("finished", j, g)]
        if k == "Charge":
            g_row(s, g, st="c"); s["ph"] = tset(s["ph"], j, None); return s, [("charge", g, EST)]
    if k == "Crash":
        j = ev[1]
        s["up"] = tset(s["up"], j, False); s["ph"] = tset(s["ph"], j, None)
        s["crashes"] = tset(s["crashes"], j, s["crashes"][j] + 1); return s, []
    if k == "Start":
        j = ev[1]
        s["up"] = tset(s["up"], j, True)
        g_settle(s, j, out, True)
        for e in s["log"][j]:
            if e is not None and e[0] == "I" and not s["uh"][j]:
                s["uh"] = tset(s["uh"], j, True); out.append(("hold", "uncertain", j, e[1]))
        return s, out
    if k == "LedgerSettle":   # owner command on a project whose run is down; revision 5.2: no process termination
        j = ev[1]
        g_settle(s, j, out, False); return s, out
    if k == "Reconcile":
        j = ev[1]
        for op, e in enumerate(s["log"][j]):
            if e is not None and e[0] == "I":
                s["log"] = tset(s["log"], j, tset(s["log"][j], op, ("R", e[1])))
                out.append(("reconciled", j, e[1]))
        s["uh"] = tset(s["uh"], j, False); return s, out
    if k == "Spend":
        g = ev[1]
        g_row(s, g, spent=s["led"][g][SPENT] + 1); s["tu"] += 1; return s, []
    if k == "Outside":
        s["tu"] += 1; s["out"] += 1; s["outs"] += 1; return s, []
    if k == "Reset":   # the provider's period ends; the clock passes the reset time
        s["pp"] += 1; s["tu"] = 0; s["out"] = 0; s["resets"] += 1; return s, []
    if k == "Snap":
        s["pend"] = (s["pp"], s["tu"]); return s, []
    if k == "Ingest":
        p = s["pend"]; s["pend"] = None
        if p[0] > s["lpp"]:
            s["lp"] += 1; s["plpp"] = s["lpp"]; s["lpp"] = p[0]; out.append(("period", s["lp"]))
        if p[0] == s["lpp"]:
            s["rd"] = p; s["rok"] = True
        g_release(s, out); return s, out
    if k == "Stale":
        s["rok"] = False; return s, []
    raise ValueError(ev)


def g_open_unowned(s, j):
    return any(r[J] == j and r[ST] == "o" and not (s["ph"][j] is not None and s["ph"][j][1] == g)
               for g, r in enumerate(s["led"]))


def g_events(s):
    evs = []
    for j in G_PROJ:
        ph = s["ph"][j]
        if not s["up"][j]:
            evs.append(("Start", j))
            if s["sfails"][j] < G_SFAIL_MAX[j]: evs.append(("StartSF", j))
            if any(r[J] == j and (r[ST] == "o" or r[ALIVE]) for r in s["led"]):
                evs.append(("LedgerSettle", j))
                if s["sfails"][j] < G_SFAIL_MAX[j]: evs.append(("LedgerSettleSF", j))
        else:
            if ph is None and (g_left(s, j) > 0 or g_open_unowned(s, j)):
                evs.append(("Run", j))
                if s["sfails"][j] < G_SFAIL_MAX[j]: evs.append(("RunSF", j))
            elif ph is not None and ph[0] == "g":
                evs.append(("Intend", j))
                if s["races"][j] < G_RACE_MAX[j]: evs.append(("Race", j))
            elif ph is not None and ph[0] == "l":
                evs.append(("CancelLost", j))
                if s["wfails"][j] < G_WFAIL_MAX[j]: evs.append(("CancelFail", j))
            elif ph is not None and ph[0] == "r":
                evs.append(("Finish", j))
            elif ph is not None and ph[0] == "f":
                evs.append(("Charge", j))
                if s["wfails"][j] < G_WFAIL_MAX[j] and G_CHARGEFAIL[j]: evs.append(("ChargeFail", j))
            if s["crashes"][j] < G_CRASH_MAX[j]:
                evs.append(("Crash", j))   # leaks52: both projects crash at any point
        if s["uh"][j]: evs.append(("Reconcile", j))
    for g, r in enumerate(s["led"]):
        if r[ALIVE] and r[SPENT] < G_MAXC[r[J]]: evs.append(("Spend", g))
    if s["outs"] < G_OUT_MAX: evs.append(("Outside",))   # amendment 3: at most 1 outside unit in all
    bnd = s["resets"] >= G_RESET_MAX
    if not bnd: evs.append(("Reset",))
    return evs, bnd   # leaks52: no Snap, Ingest or Stale event


def g_done(s):
    for j in G_PROJ:
        if s["up"][j] and not (s["ph"][j] is None and not s["uh"][j] and g_left(s, j) == 0): return False
    return all(r[ST] != "o" and not r[ALIVE] for r in s["led"])


# ---------------------------------------------------- grants51 monitor
# Sees only events and outputs. Tracks provider truth from the environment events itself.
def gm_init():
    return dict(up=(True, True), grants=(), charged=frozenset(), canceled=frozenset(), intended=frozenset(),
                finished=frozenset(), alive=frozenset(), spent=(), spentp=(), fpp=(),
                pend=(None, None), lost=(None, None), run=(None, None), fin_wait=(None, None),
                uh=(False, False), qh=(False, False),
                pp=0, tu=0, out=0, snap=None, rd=(0, 0), rout=0, rok=True, lp=0, lpp=0, plpp=-1)


def gm_open(m, g): return g not in m["charged"] and g not in m["canceled"]


def gm_usable(m): return m["rd"] is not None and m["rok"] and m["rd"][0] == m["pp"] and m["rd"][0] == m["lpp"]


def gm_counts(m, g):   # rule P as written in the design
    return g not in m["canceled"]   # rule P (5.2)


def gm_level(m): return m["rd"][1] + sum(EST for g in range(len(m["grants"])) if gm_counts(m, g))


def gm_rule1(m): return gm_usable(m) and gm_level(m) + EST <= G_CAP


def gm_may_run(m, g):
    """Can g's process still spend? Granted and not lost or ended, or alive."""
    if g in m["alive"]: return True
    j = m["grants"][g][0]
    return m["pend"][j] == g


def gm_foreman_bound(m):
    """Most that foreman's admitted steps can count in the provider's current period: units already
    spent in it plus what each step that may still run can spend (up to its maximum cost)."""
    tot = 0
    for g in range(len(m["grants"])):
        tot += m["spentp"][g]
        if gm_may_run(m, g): tot += G_MAXC[m["grants"][g][0]] - m["spent"][g]
    return tot


def gm_apply_rows(m, out, bad):
    for o in out:
        if o[0] == "cancel":
            g = o[1]
            if g in m["charged"]: bad("ND grant both charged and canceled")
            m["canceled"] = m["canceled"] | {g}
        elif o[0] == "charge":
            g = o[1]
            if g in m["charged"]: bad("ND grant charged twice")
            if g in m["canceled"]: bad("ND grant both charged and canceled")
            if g in m["alive"]: bad("ND grant charged while its process may still spend")
            m["charged"] = m["charged"] | {g}
        elif o[0] == "killed":
            g = o[1]; m["alive"] = m["alive"] - {g}; m["fpp"] = tset(m["fpp"], g, m["pp"])


def gm_settle_expect(m, j, kill):
    canc = {("cancel", g) for g, (jj, lp) in enumerate(m["grants"])
            if jj == j and gm_open(m, g) and g not in m["intended"]}
    chg = {("charge", g, EST) for g, (jj, lp) in enumerate(m["grants"])
           if jj == j and gm_open(m, g) and g in m["intended"] and (g in m["finished"] or kill)}
    return canc | chg


def gm_leak(m, j, bad):
    """LK: after a settle step of j (no step of j in flight then), no grant of j is open."""
    for g, (jj, lp) in enumerate(m["grants"]):
        if jj == j and gm_open(m, g):
            bad("LK open grant of the project after a settle step")


def g_check(m, ev, out):
    m = dict(m); v = []; k = ev[0]
    def bad(x):
        if SAFETY_ONLY and x.split()[0] in ("DC", "K", "UK"): return
        v.append(x)
    if k in ("RunSF", "StartSF", "LedgerSettleSF"):
        j = ev[1]
        if (k == "RunSF") != m["up"][j]: bad("K settle failure in the wrong state")
        kills = [o for o in out if o[0] == "killed"]
        want_k = {("killed", g) for g in m["alive"] if m["grants"][g][0] == j} if k == "StartSF" else set()
        if set(kills) != want_k: bad("K kill set differs from the text")
        gm_apply_rows(m, kills, bad)
        if any(o[0] in ("cancel", "charge", "launch", "hold") for o in out): bad("K rows or a launch after a failed settle write")
        for o in out:   # amendment 8: the monitor records such a launch (unreachable in the unmutated model)
            if o[0] == "launch":
                g = o[2]; rout = m["rout"] if m["rd"] is not None and m["rd"][0] == m["pp"] else 0
                if rout + gm_foreman_bound(m) + EST > G_CAP: bad("AS admitted launch can take provider-counted use above the cap")
                m["grants"] = m["grants"] + ((j, m["lp"]),)
                m["spent"] = m["spent"] + (0,); m["spentp"] = m["spentp"] + (0,); m["fpp"] = m["fpp"] + (None,)
                m["pend"] = tset(m["pend"], j, g)
        return m, v
    if k in ("Run", "Start", "LedgerSettle"):
        j = ev[1]; kill = k == "Start"   # revision 5.2: ledger settle kills nothing
        if k == "Run" and not m["up"][j]: bad("K run while down")
        if k == "LedgerSettle" and m["up"][j]: bad("K ledger settle while the run holds the lock")
        if k == "Start": m["up"] = tset(m["up"], j, True)
        kills = [o for o in out if o[0] == "killed"]
        want_k = {("killed", g) for g in m["alive"] if m["grants"][g][0] == j} if kill else set()
        if set(kills) != want_k: bad("K kill set differs from the text")
        gm_apply_rows(m, kills, bad)
        rows = [o for o in out if o[0] in ("cancel", "charge")]
        if set(rows) != gm_settle_expect(m, j, kill) or len(rows) != len(set(rows)):
            bad("K settle step differs from the text")
        gm_apply_rows(m, rows, bad)
        if k == "LedgerSettle":   # an Intended without Finished may still run; it stays open
            for g, (jj, lp) in enumerate(m["grants"]):
                if jj == j and gm_open(m, g) and not (g in m["intended"] and g not in m["finished"]):
                    bad("LK open grant of the project after a settle step")
        else:
            gm_leak(m, j, bad)
        if k == "Start":
            unc = {g for g, (jj, lp) in enumerate(m["grants"]) if jj == j and g in m["intended"] and g not in m["finished"]}
            holds = {o[3] for o in out if o[0] == "hold"}
            if unc and not m["uh"][j] and holds != unc: bad("K uncertain hold at startup differs")
            if holds: m["uh"] = tset(m["uh"], j, True)
            return m, v
        if k == "LedgerSettle":
            return m, v
        blocked = m["uh"][j] or m["qh"][j]
        launches = [o for o in out if o[0] == "launch"]
        holds = [o for o in out if o[0] == "hold"]
        allow = (not blocked) and gm_rule1(m)
        if launches:
            g = launches[0][2]
            if not gm_usable(m): bad("UK launch on an unusable reading")
            if blocked: bad("K launch under a hold")
            if not allow: bad("DC launch although the level rule refuses")
            # AS: provider-counted terms, from the monitor's own provider truth
            rout = m["rout"] if m["rd"] is not None and m["rd"][0] == m["pp"] else 0   # amendment 4
            if rout + gm_foreman_bound(m) + EST > G_CAP:
                bad("AS admitted launch can take provider-counted use above the cap")
            m["grants"] = m["grants"] + ((j, m["lp"]),)
            m["spent"] = m["spent"] + (0,); m["spentp"] = m["spentp"] + (0,); m["fpp"] = m["fpp"] + (None,)
            m["pend"] = tset(m["pend"], j, g)
        else:
            left = G_OPS[j] - sum(1 for g in m["intended"] if m["grants"][g][0] == j)
            if left > 0 and allow: bad("DC refused although the level rule allows")
            if (left > 0 and not blocked) != bool(holds): bad("K quota hold at a rule-1 refusal differs")
            if holds: m["qh"] = tset(m["qh"], j, True)
        return m, v
    if k in ("Intend", "Race", "CancelLost", "CancelFail", "Finish", "Charge", "ChargeFail"):
        j = ev[1]
        if not m["up"][j]: bad("K instance event while down")
        if k == "Intend":
            g = m["pend"][j]; m["pend"] = tset(m["pend"], j, None)
            m["intended"] = m["intended"] | {g}; m["run"] = tset(m["run"], j, g); m["alive"] = m["alive"] | {g}
        elif k == "Race":
            m["lost"] = tset(m["lost"], j, m["pend"][j]); m["pend"] = tset(m["pend"], j, None)
        elif k == "CancelLost":
            g = m["lost"][j]; m["lost"] = tset(m["lost"], j, None)
            if out != [("cancel", g)]: bad("K no cancel after a lost race")
            gm_apply_rows(m, out, bad)
        elif k == "CancelFail":
            m["lost"] = tset(m["lost"], j, None)
            if out: bad("K output at a failed write")
        elif k == "Finish":
            g = m["run"][j]; m["run"] = tset(m["run"], j, None)
            m["finished"] = m["finished"] | {g}; m["alive"] = m["alive"] - {g}; m["fpp"] = tset(m["fpp"], g, m["pp"])
            m["fin_wait"] = tset(m["fin_wait"], j, g)
        elif k == "ChargeFail":
            m["fin_wait"] = tset(m["fin_wait"], j, None)
            if out: bad("K output at a failed write")
        else:
            g = m["fin_wait"][j]; m["fin_wait"] = tset(m["fin_wait"], j, None)
            if out != [("charge", g, EST)]: bad("K charge is not the grant's estimate")
            gm_apply_rows(m, out, bad)
        return m, v
    if k == "Crash":
        j = ev[1]; m["up"] = tset(m["up"], j, False)
        for f in ("pend", "lost", "run", "fin_wait"): m[f] = tset(m[f], j, None)
        if out: bad("K output at a crash")
        return m, v
    if k == "Reconcile":
        j = ev[1]
        unc = [g for g, (jj, lp) in enumerate(m["grants"]) if jj == j and g in m["intended"] and g not in m["finished"]]
        if sorted(out) != sorted(("reconciled", j, g) for g in unc): bad("K reconcile differs from the text")
        for g in unc:
            m["finished"] = m["finished"] | {g}
            if gm_open(m, g): bad("LK reconcile leaves a grant open")
        m["uh"] = tset(m["uh"], j, False)
        return m, v
    # environment
    if k == "Spend":
        g = ev[1]
        if g not in m["alive"]: bad("AS a dead process spends")
        m["spent"] = tset(m["spent"], g, m["spent"][g] + 1); m["spentp"] = tset(m["spentp"], g, m["spentp"][g] + 1)
        m["tu"] += 1
    elif k == "Outside":
        m["tu"] += 1; m["out"] += 1
    elif k == "Reset":
        m["pp"] += 1; m["tu"] = 0; m["out"] = 0; m["spentp"] = (0,) * len(m["spentp"])
    elif k == "Snap":
        m["snap"] = (m["pp"], m["tu"], m["out"])
    elif k == "Ingest":
        p = m["snap"]; m["snap"] = None
        per = [o for o in out if o[0] == "period"]
        if p[0] > m["lpp"]:
            m["lp"] += 1; m["plpp"] = m["lpp"]; m["lpp"] = p[0]
            if per != [("period", m["lp"])]: bad("K new period differs")
        elif per: bad("K new period without a later reset time")
        if p[0] == m["lpp"]:
            m["rd"] = (p[0], p[1]); m["rout"] = p[2]; m["rok"] = True
    elif k == "Stale":
        m["rok"] = False
    rel = {o[2] for o in out if o[0] == "release"}
    for j in G_PROJ:
        want = k == "Ingest" and m["qh"][j] and gm_rule1(m)
        if want != (j in rel): bad("K quota release differs from the text (only a reading releases)")
        if want: m["qh"] = tset(m["qh"], j, False)
    if any(o[0] not in ("release", "period") for o in out): bad("K unexpected output on an environment event")
    return m, v


def g_count(s, ev, out, cnt):
    for o in out:
        if o[0] == "launch":
            if any(r[ST] == "o" and r[J] != ev[1] for r in s["led"]): cnt["launch_other_open"] += 1
            if any(r[LP] != s["lp"] and r[ST] == "c" and g_counts(s, r) for r in s["led"]): cnt["launch_spanning_carried"] += 1
            if sum(1 for r in s["led"] if r[J] == ev[1]) > 1: cnt["launch_second_operation_or_relaunch"] += 1
        if o[0] == "hold" and o[1] == "quota":
            cnt["quota_hold_unusable" if not g_usable(s) else "quota_hold_level"] += 1
            if g_usable(s) and s["rd"][1] + sum(EST - r[SPENT] for r in s["led"] if r[ST] == "o") + EST <= G_CAP:
                cnt["refused_by_counting_finished_steps"] += 1
        if o[0] == "hold" and o[1] == "uncertain": cnt["uncertain_hold"] += 1
        if ev[0] == "Run" and o[0] == "cancel": cnt["ordinary_settle_cancel"] += 1
        if ev[0] == "Run" and o[0] == "charge": cnt["ordinary_settle_charge"] += 1
        if o[0] == "killed": cnt["kill_" + ev[0].replace("SF", "")] += 1
    if ev[0] in ("CancelFail", "ChargeFail"): cnt[ev[0]] += 1
    if ev[0] == "Crash" and s["ph"][ev[1]] is not None and s["ph"][ev[1]][0] == "l": cnt["crash_after_lost_race"] += 1
    if ev[0] == "Spend" and not s["up"][s["led"][ev[1]][J]]: cnt["orphan_process_spend"] += 1
    if ev[0] == "Spend" and (s["pp"] > s["lpp"] or s["led"][ev[1]][LP] < s["lp"]): cnt["spend_in_undetected_or_later_period"] += 1
    if ev[0] == "LedgerSettle": cnt["ledger_settle"] += 1
    if ev[0] == "Reconcile": cnt["reconcile"] += 1
    if ev[0] in ("RunSF", "StartSF", "LedgerSettleSF"): cnt["settle_write_failed_" + ev[0]] += 1


G_CNT = ("launch_other_open", "launch_spanning_carried", "launch_second_operation_or_relaunch", "quota_hold_unusable",
         "quota_hold_level", "refused_by_counting_finished_steps", "uncertain_hold", "ordinary_settle_cancel",
         "ordinary_settle_charge", "kill_Start", "kill_LedgerSettle", "CancelFail", "ChargeFail",
         "crash_after_lost_race", "orphan_process_spend", "spend_in_undetected_or_later_period",
         "ledger_settle", "reconcile", "settle_write_failed_RunSF", "settle_write_failed_StartSF",
         "settle_write_failed_LedgerSettleSF")




# =================================================================
# Scope "periods52": readings, periods, resets, clocks and outside use
# =================================================================
P_PROJ = (0, 1); P_OPS = (1, 1); P_U = 3; P_RES = 1; P_CAP = P_U - P_RES   # amendment 1: P_OPS was (2, 1)
P_OUT_MAX = 2;   # amendment 1: was 3
P_SNAP_MAX = 2; P_PEND_MAX = 2; P_RESET_MAX = 1; P_BACK_MAX = 1; P_PASS_MAX = 1
# Ledger row: (project, status o/c/x/r, process alive, units spent, units spent in the current provider
#              period, ended before the clock passed the ledger period's recorded reset time, issue ledger period)
PJ, PST, PAL, PSP, PSC, PEB, PLP = range(7)


def p_initial():
    return dict(left=P_OPS, led=(),
                pp=0, tu=0, clk=0,          # provider period, its counted use; the wall clock has passed R_q for q < clk
                outs=(), nout=0,            # outside units of the current provider period (snapshots taken before each)
                nsnap=0, pend=(), lsnap=None,   # pending snapshots (idx, q, used, hasR, wall); newest ingested (idx, q)
                backs=0, resets=0, passes=0,
                lp=0, lq=None, lpt=0, lobs=0, rds=(), fresh=False)


def p_passed(s): return s["lq"] is not None and s["clk"] > s["lq"]
def p_read(s): return max(u for u, w in s["rds"])          # highest usedPercent of the period's readings
def p_usable(s): return len(s["rds"]) > 0 and s["fresh"] and not p_passed(s)
def p_counts(r): return r[PST] in ("o", "c")                # rule P (5.2): every grant not canceled or retired
def p_level(s): return p_read(s) + sum(EST for r in s["led"] if p_counts(r))
def p_allows(s): return p_usable(s) and p_level(s) + EST <= P_CAP


def p_prow(s, g, **kw):
    r = list(s["led"][g])
    for k, v in kw.items(): r[{"st": PST, "al": PAL, "sp": PSP, "sc": PSC, "eb": PEB}[k]] = v
    s["led"] = tset(s["led"], g, tuple(r))


def p_open_period(s, q, rd):
    s["lp"] += 1; s["lq"] = q; s["rds"] = (rd,) if rd is not None else (); s["fresh"] = rd is not None
    s["lpt"] = s["pp"]


def p_unseen(s):
    if s["lsnap"] is None: return 0
    idx, q = s["lsnap"]
    return sum(1 for v in s["outs"] if v >= idx) if q == s["pp"] else len(s["outs"])


def p_decide(s, ev):
    s = dict(s); out = []; k = ev[0]
    if k == "Run":
        j = ev[1]
        if p_allows(s):
            g = len(s["led"])
            s["led"] = s["led"] + ((j, "o", True, 0, 0, False, s["lp"]),)
            s["left"] = tset(s["left"], j, s["left"][j] - 1)
            return s, [("launch", j, g)]
        return s, [("refuse", j)]
    if k == "Spend":
        g = ev[1]; r = s["led"][g]
        p_prow(s, g, sp=r[PSP] + 1, sc=r[PSC] + 1); s["tu"] += 1; return s, []
    if k == "Finish":
        g = ev[1]
        p_prow(s, g, al=False, st="c", eb=(s["lq"] is None or s["clk"] <= s["lq"]))
        return s, [("charge", g, EST)]
    if k == "Retire":     # owner command `ledger retire`, on the owner's knowledge (see the header)
        p_prow(s, ev[1], st="r"); return s, [("retire", ev[1])]
    if k == "LedgerReset":
        p_open_period(s, None, None); s["lobs"] = s["nsnap"]   # amendment 5: readings observed before the command never join
        return s, [("ownerperiod", s["lp"])]
    if k == "Outside":
        s["tu"] += 1; s["outs"] = s["outs"] + (s["nsnap"],); s["nout"] += 1; return s, []
    if k in ("Reset", "EarlyReset"):
        if k == "Reset": s["clk"] = max(s["clk"], s["pp"] + 1)
        s["pp"] += 1; s["tu"] = 0; s["outs"] = (); s["resets"] += 1
        s["led"] = tuple(r[:PSC] + (0,) + r[PSC + 1:] for r in s["led"]); return s, []
    if k == "ClockPass":
        s["clk"] = s["pp"] + 1; s["passes"] += 1; return s, []
    if k == "ClockBack":
        s["clk"] = max(0, s["clk"] - 1); s["backs"] += 1; return s, []
    if k == "Snap":
        s["nsnap"] += 1
        # amendment 1: the wall stamp is idx - 2 after a ClockBack, idx before; it is derived, not stored
        s["pend"] = s["pend"] + ((s["nsnap"], s["pp"], s["tu"], ev[1], s["nsnap"] - 2 * s["backs"]),); return s, []
    if k == "Ingest":
        i = next(n for n, p in enumerate(s["pend"]) if p[0] == ev[1]); idx, q, used, hasR, w = s["pend"][i]
        s["pend"] = s["pend"][:i] + s["pend"][i + 1:]
        if s["lsnap"] is None or idx > s["lsnap"][0]: s["lsnap"] = (idx, q)
        if hasR and s["lq"] is not None and q > s["lq"]:
            p_open_period(s, q, (used, w)); return s, [("period", s["lp"])]
        if hasR and s["lq"] is not None and q < s["lq"]:
            return s, [("dropped",)]
        if idx <= s["lobs"]:
            return s, [("dropped",)]
        if hasR and s["lq"] is None: s["lq"] = q
        s["rds"] = s["rds"] + ((used, w),); s["fresh"] = True; return s, []
    if k == "Stale":
        s["fresh"] = False; return s, []
    raise ValueError(ev)


def p_events(s):
    evs = []
    for j in P_PROJ:
        if s["left"][j] > 0: evs.append(("Run", j))
    for g, r in enumerate(s["led"]):
        if r[PAL] and r[PSP] < EST: evs.append(("Spend", g))
        if r[PAL]: evs.append(("Finish", g))
        if r[PST] == "c" and r[PSC] == 0: evs.append(("Retire", g))
    if s["pp"] > s["lpt"]: evs.append(("LedgerReset",))
    if s["nout"] < P_OUT_MAX and not (s["fresh"] and p_unseen(s) >= P_RES): evs.append(("Outside",))
    if s["resets"] < P_RESET_MAX: evs += [("Reset",), ("EarlyReset",)]
    if s["backs"] < P_BACK_MAX: evs.append(("ClockBack",))
    if s["nsnap"] < P_SNAP_MAX and len(s["pend"]) < P_PEND_MAX: evs += [("Snap", True), ("Snap", False)]
    for p in s["pend"]:   # amendment 4: under A5 a reading whose unseen outside use exceeds the reserve never arrives
        unseen = sum(1 for v in s["outs"] if v >= p[0]) if p[1] == s["pp"] else len(s["outs"])
        if NO_A5 or unseen <= P_RES: evs.append(("Ingest", p[0]))
    if s["fresh"]: evs.append(("Stale",))
    return evs, s["nsnap"] >= P_SNAP_MAX and not any(e[0] == "Ingest" for e in evs)


def p_done(s):
    return all(n == 0 for n in s["left"]) and not any(r[PAL] for r in s["led"])


# ---------------------------------------------------- periods52 monitor
# Sees only events and outputs; keeps the provider's count and the outside use itself.
def pm_init():
    return dict(pp=0, tu=0, outs=(), nsnap=0, snaps=(), lsnap=None, alive=frozenset(), spent=())


def pm_check(m, ev, out):
    m = dict(m); v = []; k = ev[0]
    def bad(x): v.append(x)
    for o in out:
        if o[0] == "launch":
            if m["lsnap"] is None: unseen = 0
            else:
                idx, q = m["lsnap"]
                unseen = sum(1 for x in m["outs"] if x >= idx) if q == m["pp"] else len(m["outs"])
            rem = sum(EST - m["spent"][g] for g in m["alive"])
            if m["tu"] + rem + EST > P_CAP + min(unseen, P_RES):
                bad("TC admitted launch can take the provider's total count above the cap plus the unseen outside use the reserve covers")
            g = o[2]; m["alive"] = m["alive"] | {g}; m["spent"] = m["spent"] + (0,)
    if k == "Spend":
        g = ev[1]
        if g not in m["alive"]: bad("TC a dead process spends")
        m["spent"] = tset(m["spent"], g, m["spent"][g] + 1); m["tu"] += 1
    elif k == "Finish":
        m["alive"] = m["alive"] - {ev[1]}
    elif k == "Outside":
        m["tu"] += 1; m["outs"] = m["outs"] + (m["nsnap"],)
    elif k in ("Reset", "EarlyReset"):
        m["pp"] += 1; m["tu"] = 0; m["outs"] = ()
    elif k == "Snap":
        m["nsnap"] += 1; m["snaps"] = m["snaps"] + (m["pp"],)
    elif k == "Ingest":
        idx = ev[1]
        if m["lsnap"] is None or idx > m["lsnap"][0]: m["lsnap"] = (idx, m["snaps"][idx - 1])
    return m, v


def p_count(s, ev, out, cnt):
    for o in out:
        if o[0] == "launch":
            if s["pp"] > 0 and s["clk"] < s["pp"]: cnt["launch_after_early_reset"] += 1
            if any(r[PST] == "c" and r[PLP] < s["lp"] for r in s["led"]): cnt["launch_with_carried_charge"] += 1
            if s["backs"] > 0: cnt["launch_after_clock_back"] += 1
            if s["nout"] > P_RES: cnt["launch_with_outside_above_reserve"] += 1
            if s["rds"] and max(u for u, w in s["rds"]) < s["tu"]: cnt["launch_on_delayed_reading"] += 1
            if s["lsnap"] is not None and any(p[0] < s["lsnap"][0] for p in s["pend"]): cnt["launch_with_older_snapshot_pending"] += 1
        if o[0] == "refuse":
            if not p_usable(s): cnt["refused_unknown"] += 1
            elif p_read(s) + sum(EST for r in s["led"] if r[PST] == "o") + EST <= P_CAP: cnt["refused_only_by_carried_charges"] += 1
        if o[0] == "dropped": cnt["earlier_period_reading_dropped"] += 1
        if o[0] == "retire": cnt["owner_retire"] += 1
    if ev[0] == "Ingest":
        p = next(p for p in s["pend"] if p[0] == ev[1])
        if s["lsnap"] is not None and p[0] < s["lsnap"][0]: cnt["ingest_out_of_order"] += 1
        if s["rds"] and p[2] < p_read(s) and not (p[3] and s["lq"] is not None and p[1] != s["lq"]): cnt["false_drop_kept_in_period"] += 1
        if not p[3]: cnt["reading_without_reset_time"] += 1
    if ev[0] == "LedgerReset": cnt["owner_ledger_reset"] += 1
    if ev[0] == "EarlyReset": cnt["early_reset"] += 1


P_CNT = ("launch_after_early_reset", "launch_with_carried_charge", "launch_after_clock_back",
         "launch_with_outside_above_reserve", "launch_on_delayed_reading", "launch_with_older_snapshot_pending",
         "refused_unknown", "refused_only_by_carried_charges", "earlier_period_reading_dropped", "owner_retire",
         "ingest_out_of_order", "false_drop_kept_in_period", "reading_without_reset_time", "owner_ledger_reset",
         "early_reset")

# ---------------------------------------------------------------- search
def freeze(d): return tuple(d.values())


def main():
    if SCOPE == "leaks52":
        F = dict(init=g_initial, minit=gm_init, events=g_events, decide=g_decide, check=g_check, done=g_done,
                 count=g_count, names=G_CNT, prog=("launch", "reconciled"))
    else:
        F = dict(init=p_initial, minit=pm_init, events=p_events, decide=p_decide, check=pm_check, done=p_done,
                 count=p_count, names=P_CNT, prog=("launch", "retire", "ownerperiod"))
    s0, m0 = F["init"](), F["minit"]()
    k0 = (freeze(s0), freeze(m0))
    ids = {k0: 0}; par = [None]
    dq = deque([(s0, m0)]); n = 0; launches = 0
    violations = {}; ea = array("l"); eb = array("l"); progsrc = set(); expanded = set(); bounded = set(); finished = set()
    cnt = {c: 0 for c in F["names"]}
    t0 = time.time()

    def tr(i):
        o = []
        while par[i] is not None: i, e = par[i]; o.append(e)
        return tuple(reversed(o))
    while dq:
        s, m = dq.popleft(); n += 1
        kid = ids[(freeze(s), freeze(m))]
        if n % 100000 == 0:
            print(f"progress {n} states, frontier {len(dq)}, {time.time()-t0:.0f}s", flush=True)
        if F["done"](s):
            finished.add(kid); continue
        evs, bnd = F["events"](s)
        expanded.add(kid)
        if bnd: bounded.add(kid)
        for ev in evs:
            s2, out = F["decide"](s, ev)
            launches += sum(1 for o in out if o[0] == "launch")
            F["count"](s, ev, out, cnt)
            m2, v = F["check"](m, ev, out)
            key = (freeze(s2), freeze(m2))
            if key not in ids:
                ids[key] = len(par); par.append((kid, ev))
                if not v: dq.append((s2, m2))
            prog = any(o[0] in F["prog"] for o in out)
            if prog: progsrc.add(kid)
            elif ids[key] != kid: ea.append(kid); eb.append(ids[key])
            for x in v:
                if x.split()[0] not in violations:
                    violations[x.split()[0]] = (x, kid, ev)
                    print("FOUND", x, flush=True)
                    if "--stop" in sys.argv:
                        print(f"stopped at first violation after {n} states")
                        for e in tr(kid) + (ev,): print("   ", e)
                        return
    print(f"scope {SCOPE}: states explored: {n}; launch transitions: {launches}; finished states: {len(finished)}; bounded states: {len(bounded)}; {time.time()-t0:.0f}s")
    print("counters:", cnt)
    for name, (x, kid, ev) in violations.items():
        print(f"VIOLATION {x}:")
        for e in tr(kid) + (ev,): print("   ", e)
    preds = {}
    for a, b in zip(ea, eb): preds.setdefault(b, []).append(a)

    def reach(seed):
        good = set(seed)
        good |= progsrc
        work = list(good)
        while work:
            x = work.pop()
            for y in preds.get(x, []):
                if y not in good: good.add(y); work.append(y)
        return good
    good = reach(set(bounded) | finished | {i for i in range(len(par)) if i not in expanded})
    dead = [i for i in expanded if i not in good]
    print(f"liveness: states with no path to a launch, an owner release or the end: {len(dead)}")
    for i in sorted(dead)[:4]:
        print("DEADLOCK trace:", tr(i))
    sgood = reach(finished | {i for i in range(len(par)) if i not in expanded})
    sdead = [i for i in expanded if i not in sgood]
    print(f"strict liveness (no credit for BOUNDED): {len(sdead)} states")
    if not violations and not dead: print("no violations")


if __name__ == "__main__":
    main()

