"""AMENDMENT 4 (after run 4, scope grants51 under amendment 3: 1,636,070
states, no violations, liveness 0; the monitor only, fixed before the
mutation runs and run 5). (a) AS is checked at every launch, also one on
a reading that is not of the provider's current period (then the
reading's outside use counts as 0, so foreman's own steps must fit under
the cap); before, AS was checked only on a usable reading, so a launch
without one could pass AS vacuously. (b) UK restates the written
usability rule, so --safety-only drops it with DC and K. The model is
unchanged.

AMENDMENT 3 (after run 3, scope grants51 under amendment 2: stopped by
hand at about 210 s with 3,600,000 states, the frontier near 770,000 and
level, and 2.7 GB resident on a shared machine). Changes, fixed before
run 4: (a) at most 1 outside unit in all (it was 1 per provider period);
(b) project 1 crashes only after a lost race and before its cancel (the
path finding 5 asked for); project 0 still crashes at any point. What
scope grants51 no longer covers: outside use in both periods, and other
crash points for project 1 (project 0 covers them).

AMENDMENT 2 (after run 2, scope grants51 under amendment 1: stopped by
hand at about 215 s with 2,600,000 states, the frontier at 1,687,154 and
growing, and 1.9 GB resident; no violation reported). Changes, fixed
before run 3: each project has 1 operation (project 0 had 2), and U = 3,
so the cap is 2 (it was 3). The cap is still reachable: two grants, or
one grant and the outside unit, fill it, and a reading that shows a
finished step plus that step's own count refuse a second launch. What
scope grants51 no longer covers: a project that launches again after its
own earlier step (project 1 still launches after project 0's step, and
after a lost race it launches again under a new grant).

AMENDMENT 1 (after run 1, scope grants51: stopped at 120 s with
1,500,000 states and the frontier at 1,239,275, growing; no violation
reported). Changes, fixed before run 2: (a) no Stale event (UK is still
exercised: there is no reading at the start, and a reading of a passed
provider period is unusable); (b) ChargeFail only for project 0 (CancelFail
can arise only for project 1, the one that can lose a race). What scope
grants51 no longer covers: a reading going stale by age, and a failed
charge write by project 1.

Model check M5.1: the revision-5.1 ledger rules of the agent supervisor
design (docs/plans/2026-11-14-agent-supervisor-design.md, revision 5.1).
check4.py (M4) and check5.py (M5) are kept unchanged. Scopes stages5 and
queue5 are M5's, with one change (below); scope grants51 replaces M5's
scope grants. A passing run supports only the rules modeled here, within
the grammar and bounds below.

GRAMMAR AND BOUNDS (fixed before the first run; amendments, if any, are
added above this header, labeled with before and after results).

House style as in M4 and M5: a pure decide(s, ev) -> (s, out); a monitor
check(m, ev, out) that never sees model state; BFS over (model, monitor)
states; liveness by backward reachability; counters. New in M5.1: the
monitor tracks the provider's counted use itself, from the environment
events, apart from anything foreman records, and the admission-safety
property AS is checked against that quantity. Violation tags DC and K are
restatement checks (the monitor recomputes the written rule); AS, LK, ND
are the properties; UK restates the usability rule (amendment 4).
--safety-only drops DC, K and UK, so a mutant run with it is killed only
by AS, LK, ND or liveness.

=== Scope "grants51" ===

One provider c, one window. Projects 0 and 1 share the account. Project 0
has 2 operations, project 1 has 1; each is a launch of c. Integer units:
U = 4, reserve 1, cap 3, estimate EST = 1.

Provider (truth). A provider period index pp and the provider's counted
use tu in the current period. Spend(g): a live process of grant g uses 1
unit, counted at once in tu (a delayed count is the same as a reading
taken earlier; see Snap). A step's total use is at most its maximum cost:
EST under assumption A1 (estimates bound use); with --overshoot, project
0's steps may use EST + 1. Outside: the owner's own use, at most 1 unit
per provider period. Reset: the provider's period ends (at most 1); the
clock passes the old reset time at the same moment (skew is abstracted).
Snap: the provider's count is captured as a reading, (pp, tu), not yet
seen by foreman; Ingest: foreman ingests it, possibly after further
Spend, Outside and Reset events (this is the reading delay, unbounded in
length). At most one snapshot is pending. Stale: the reading ages past
freshness.

Foreman. Ledger rows: Grant(g) with (project, operation, issue ledger
period), then at most one of Charged(g) at EST or GrantCanceled(g); the
process end's provider period (endedAt against the recorded reset time).
Project log per operation: Intended(g), Finished(g), Reconciled(g).
Ledger periods: Ingest of a snapshot of a later provider period opens a
new ledger period (PeriodOpened); a snapshot of an earlier provider period
is dropped (period membership); otherwise it becomes the reading.

Events.
  Run(j)        settle step (cancel every open grant of j that no Intended
                names, by grantId; charge every Finished without Charged at
                EST); then, with no Quota or Uncertain hold and an operation
                left, admission: launch only if the reading is usable and
                level + EST <= cap, else a Quota hold. Enabled while j has
                an operation left or an open grant not in flight. A ledger
                transaction that times out changes nothing; it is not a
                separate event.
  Intend(j)     Intended appended; the process starts (alive).
  Race(j)       the compare-and-append loses (project 1, at most 1).
  CancelLost(j) GrantCanceled for the lost grant.
  CancelFail(j) that write times out; the attempt ends, the grant stays
                open (at most 1 write failure per project).
  Finish(j)     the process exits; Finished appended.
  Charge(j)     Charged at EST.
  ChargeFail(j) that write times out; the grant stays open.
  Crash(j)      the instance dies (at most 1 per project, in any phase,
                including after a lost race and before its cancel); a
                running process survives and may go on spending.
  Start(j)      restart: kill j's live processes (end = now), settle step,
                and charge each Intended-without-Finished at EST; Uncertain
                hold for it.
  LedgerSettle(j) owner command while j is down: the same kill and settle
                as Start, without restarting j and without a hold.
  Reconcile(j)  owner: releases the Uncertain hold; the grant is already
                charged.
  Spend(g), Outside, Reset, Snap, Ingest, Stale  as above. Ingest releases
                a Quota hold when rule 1 then allows; nothing else does.

Usable reading: ingested, not stale, of the ledger's current period, and
of the provider's current period (the clock has not passed its reset
time). Level (the written rule 1): r.used + EST for every grant that
counts in the current ledger period (rule P): issued in it, or open, or
charged with an end not provably before the previous period's reset
time. Canceled grants count nothing. No reading ever reflects a grant.

Properties.
  AS  admission safety in provider terms: at every launch, (outside use
      the reading saw) + (units foreman's steps have used in the
      provider's current period) + (what every step that may still run can
      still use) + EST <= cap. Computed by the monitor from the
      environment events alone.
  LK  after the settle step of every Run(j), Start(j) and LedgerSettle(j),
      no grant of j is open (no step of j is in flight then).
  ND  no grant charged twice or both charged and canceled; no grant
      charged while its process may still spend.
  UK  no launch on an unusable reading.
  DC  (restatement) the model launches exactly when the monitor's level
      rule allows.
  K   (restatement) settle, kill, hold, release and period outputs match
      the text.
Liveness: from every expanded state a launch, an owner Reconcile or the
end is reachable (BOUNDED states, where the one reset is used, get
credit; strict liveness is reported for information). The end: every
project that is up has finished its operations; every grant is settled;
no process is alive. A project that is down may stay down.

Expected with --overshoot: an AS violation (a step using more than its
estimate takes the provider's count above the cap). That run shows that
assumption A1 carries the AS result; it is not a defect of the model.

=== Scopes "stages5" and "queue5" ===

As in check5.py (see its header and amendments 3-5), with one change for
revision 5.1: TimerPass ends a loosening spend-down only; a tightening
spend-down ends only at a new period or SpendDownCancel. The monitor's
"active" test changes accordingly.
"""
from collections import deque
import sys, time

SCOPE = next((a for a in sys.argv[1:] if a in ("grants51", "stages5", "queue5")), "grants51")
OVERSHOOT = "--overshoot" in sys.argv          # assumption A1 dropped: project 0's steps may cost EST + 1
SAFETY_ONLY = "--safety-only" in sys.argv      # restatement checks (tags DC, K, UK) are not reported


def tset(tup, i, v):
    l = list(tup); l[i] = v; return tuple(l)


# =================================================================
# Scope "grants51": provider truth modeled apart from the ledger
# =================================================================
G_PROJ = (0, 1); G_OPS = (1, 1); G_U = 3; G_RES = 1; G_CAP = G_U - G_RES; EST = 1   # amendment 2: were (2, 1) and U = 4
G_MAXC = (EST + 1, EST) if OVERSHOOT else (EST, EST)
G_OUT_MAX = 1; G_RESET_MAX = 1
G_RACE_MAX = (0, 1); G_CRASH_MAX = (1, 1); G_WFAIL_MAX = (1, 1)
G_CHARGEFAIL = (True, False)   # amendment 1: ChargeFail for project 0 only (CancelFail can arise for project 1 only)
# Ledger row: (project, op, issue ledger period, status o/c/x, provider period at end or None,
#              process alive, units spent)
J, OP, LP, ST, FPP, ALIVE, SPENT = range(7)


def g_initial():
    return dict(up=(True, True), ph=(None, None), log=tuple((None,) * n for n in G_OPS), uh=(False, False),
                qh=(False, False), led=(),
                pp=0, tu=0, out=0,                  # provider: period, counted use, outside use this period
                pend=None,                           # a snapshot taken but not yet ingested: (pp, tu)
                rd=None, rok=False,                  # the newest ingested reading of the ledger period: (pp, tu)
                lp=0, lpp=0, plpp=-1,                # ledger period, its provider period, the previous one's
                resets=0, outs=0, races=(0, 0), crashes=(0, 0), wfails=(0, 0))


def g_counts(s, r):
    """Rule P: a grant counts in the current ledger period when it was issued in it, is still open,
    or was charged with an end not provably before the previous period's reset time."""
    if r[ST] == "x": return False
    return r[LP] == s["lp"] or r[ST] == "o" or (r[FPP] is not None and r[FPP] > s["plpp"])


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
    if k == "LedgerSettle":   # owner command on a project whose run is down
        j = ev[1]
        g_settle(s, j, out, True); return s, out
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
            if any(r[J] == j and (r[ST] == "o" or r[ALIVE]) for r in s["led"]): evs.append(("LedgerSettle", j))
        else:
            if ph is None and (g_left(s, j) > 0 or g_open_unowned(s, j)):
                evs.append(("Run", j))
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
            if s["crashes"][j] < G_CRASH_MAX[j] and (j == 0 or (ph is not None and ph[0] == "l")):
                evs.append(("Crash", j))   # amendment 3: project 1 crashes only after a lost race
        if s["uh"][j]: evs.append(("Reconcile", j))
    for g, r in enumerate(s["led"]):
        if r[ALIVE] and r[SPENT] < G_MAXC[r[J]]: evs.append(("Spend", g))
    if s["outs"] < G_OUT_MAX: evs.append(("Outside",))   # amendment 3: at most 1 outside unit in all
    bnd = s["resets"] >= G_RESET_MAX
    if not bnd: evs.append(("Reset",))
    evs.append(("Ingest",) if s["pend"] is not None else ("Snap",))
    return evs, bnd   # amendment 1: no Stale event


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
                pp=0, tu=0, out=0, snap=None, rd=None, rout=0, rok=False, lp=0, lpp=0, plpp=-1)


def gm_open(m, g): return g not in m["charged"] and g not in m["canceled"]


def gm_usable(m): return m["rd"] is not None and m["rok"] and m["rd"][0] == m["pp"] and m["rd"][0] == m["lpp"]


def gm_counts(m, g):   # rule P as written in the design
    if g in m["canceled"]: return False
    return m["grants"][g][1] == m["lp"] or gm_open(m, g) or (m["fpp"][g] is not None and m["fpp"][g] > m["plpp"])


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
            if g in m["alive"]: bad("AS grant charged while its process may still spend")
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
    if k in ("Run", "Start", "LedgerSettle"):
        j = ev[1]; kill = k != "Run"
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
            if s["rd"][1] < s["tu"]: cnt["launch_on_delayed_reading"] += 1
        if o[0] == "hold" and o[1] == "quota":
            cnt["quota_hold_unusable" if not g_usable(s) else "quota_hold_level"] += 1
            if g_usable(s) and s["rd"][1] + sum(EST - r[SPENT] for r in s["led"] if r[ST] == "o") + EST <= G_CAP:
                cnt["refused_by_counting_finished_steps"] += 1
        if o[0] == "hold" and o[1] == "uncertain": cnt["uncertain_hold"] += 1
        if ev[0] == "Run" and o[0] == "cancel": cnt["ordinary_settle_cancel"] += 1
        if ev[0] == "Run" and o[0] == "charge": cnt["ordinary_settle_charge"] += 1
        if o[0] == "killed": cnt["kill_" + ev[0]] += 1
    if ev[0] in ("CancelFail", "ChargeFail"): cnt[ev[0]] += 1
    if ev[0] == "Crash" and s["ph"][ev[1]] is not None and s["ph"][ev[1]][0] == "l": cnt["crash_after_lost_race"] += 1
    if ev[0] == "Spend" and not s["up"][s["led"][ev[1]][J]]: cnt["orphan_process_spend"] += 1
    if ev[0] == "Spend" and (s["pp"] > s["lpp"] or s["led"][ev[1]][LP] < s["lp"]): cnt["spend_in_undetected_or_later_period"] += 1
    if ev[0] == "LedgerSettle": cnt["ledger_settle"] += 1
    if ev[0] == "Reconcile": cnt["reconcile"] += 1
    if ev[0] == "Ingest" and s["pend"][0] < s["lpp"]: cnt["old_period_reading_dropped"] += 1


G_CNT = ("launch_other_open", "launch_spanning_carried", "launch_on_delayed_reading", "quota_hold_unusable",
         "quota_hold_level", "refused_by_counting_finished_steps", "uncertain_hold", "ordinary_settle_cancel",
         "ordinary_settle_charge", "kill_Start", "kill_LedgerSettle", "CancelFail", "ChargeFail",
         "crash_after_lost_race", "orphan_process_spend", "spend_in_undetected_or_later_period",
         "ledger_settle", "reconcile", "old_period_reading_dropped")


# =================================================================
# Scopes "stages5" and "queue5" (M4's stages machinery plus B1-B4)
# =================================================================
PROVS = ("c", "x")
PER_MAX = 1; OUT_MAX = 1
if SCOPE == "queue5":
    T = 3; BOUND = 1; BACKLOG_MAX = 1
else:
    T = 2; BOUND = 2; BACKLOG_MAX = 2
PROJ = (0,); MAXR = (1,)
U = 8; RESERVE = 2; ALLOC = (2,); CEIL = (2,); SD_TIGHT = 5; SD_LOOSE = 7; OUT_PROVS = ("c",)
ROLE = {"impl": "implementer", "correct": "corrector", "review": "reviewer"}


def client(roles, step):
    edit = "c" if roles == "std" else "x"
    return edit if step != "review" else ("x" if edit == "c" else "c")


def initial():
    n = len(PROJ)
    return dict(tip=(0,) * n, queue=((),) * n, corr=(None,) * n, rounds=(0,) * n,
                ahold=(0,) * n, qh=(frozenset(),) * n, pre=(frozenset(),) * n,
                live=(frozenset(),) * n, roles=("std",) * n, infl=(None,) * n, wv=(None,) * n,
                spend=(0,) * (2 * n), out=(0, 0), per=(0, 0), passed=(False, False),
                ovr=(None, None), first="c")


def used(s, pi): return sum(s["spend"][j * 2 + pi] for j in PROJ) + s["out"][pi]
def cap(s, pi): return s["ovr"][pi] if s["ovr"][pi] is not None else U - RESERVE
def rule1(s, pi): return (not s["passed"][pi]) and used(s, pi) + EST <= cap(s, pi)


def rule2(s, j, pi):
    if s["ovr"][pi] is not None and s["ovr"][pi] > U - RESERVE:
        return True
    return (s["spend"][j * 2 + pi] + EST <= CEIL[j]
            and sum(s["spend"][k * 2 + pi] for k in PROJ) + EST <= sum(ALLOC))


def started(s, j, t):
    f = s["infl"][j]
    return s["tip"][j] >= t or (f is not None and f[0] == "impl" and f[1] == t)


def plain(s, j, t): return (t, False) in s["pre"][j]
def has_entry(s, j, t): return (t, False) in s["pre"][j] or (t, True) in s["pre"][j]


def candidates(s, j):
    if s["corr"][j] is not None:
        return [("correct", s["corr"][j])]
    c = []
    q = s["queue"][j]
    if q: c.append(("review", q[0]))
    nxt = s["tip"][j] + 1
    if nxt <= T and (plain(s, j, nxt) or nxt in s["live"][j]) and len(q) + 1 <= BOUND:
        c.append(("impl", nxt))
    return c


def edf(s, j, cands):
    def key(cd):
        return (0 if client(s["roles"][j], cd[0]) == s["first"] else 1, 0 if cd[0] == "review" else 1)
    return sorted(cands, key=key)


def do_launch(s, j, cd, p, waived, out):
    pi = PROVS.index(p)
    s["spend"] = tset(s["spend"], j * 2 + pi, s["spend"][j * 2 + pi] + EST)
    if cd[0] == "impl":
        s["pre"] = tset(s["pre"], j, s["pre"][j] - {(cd[1], False), (cd[1], True)})
        s["live"] = tset(s["live"], j, s["live"][j] - {cd[1]})
    s["infl"] = tset(s["infl"], j, (cd[0], cd[1], pi, s["per"][pi]))
    out.append(("launch", j, cd[0], cd[1], p, ROLE[cd[0]], "ro" if cd[0] == "review" else "edit", waived))


def decide(s, ev):
    s = dict(s); out = []; k = ev[0]
    if k == "Run":
        j = ev[1]
        cands = edf(s, j, candidates(s, j))
        w = s["wv"][j]
        if w is not None:
            s["wv"] = tset(s["wv"], j, None)
            if s["ahold"][j] is None:
                wc = [cd for cd in cands if client(s["roles"][j], cd[0]) == w]
                if wc:
                    do_launch(s, j, wc[0], w, True, out); return s, out
            out.append(("waiver_expired", j, w))
        if s["infl"][j] is not None or s["ahold"][j] is not None:
            out.append(("refuse",)); return s, out
        refused1 = None
        for cd in cands:
            p = client(s["roles"][j], cd[0]); pi = PROVS.index(p)
            if p in s["qh"][j]:
                continue
            if rule1(s, pi) and rule2(s, j, pi):
                do_launch(s, j, cd, p, False, out); return s, out
            if refused1 is None and not rule1(s, pi):
                refused1 = p
        if refused1 is not None:
            s["qh"] = tset(s["qh"], j, s["qh"][j] | {refused1})
            out.append(("hold", "quota", j, refused1))
            other = "x" if refused1 == "c" else "c"; oi = PROVS.index(other)
            if s["first"] == other and rule1(s, oi):
                out.append(("suggest", j))
        if not any(o[0] != "waiver_expired" for o in out): out.append(("refuse",))
        return s, out
    if k == "Exit":
        j, o, cost = ev[1], ev[2], ev[3]
        step, t, pi, per = s["infl"][j]
        if per == s["per"][pi]:
            s["spend"] = tset(s["spend"], j * 2 + pi, s["spend"][j * 2 + pi] + cost - EST)
        s["infl"] = tset(s["infl"], j, None)
        out.append(("exit", j, step, t, o))
        if step == "impl":
            s["tip"] = tset(s["tip"], j, t)
            s["queue"] = tset(s["queue"], j, s["queue"][j] + (t,))
        elif step == "correct":
            s["corr"] = tset(s["corr"], j, None)
        else:
            q = s["queue"][j]; h = q[0]
            if o == "pass":
                s["queue"] = tset(s["queue"], j, q[1:]); s["rounds"] = tset(s["rounds"], j, 0)
                nxt = h + 1
                if not (nxt <= T and (plain(s, j, nxt) or nxt in s["live"][j] or started(s, j, nxt))):
                    s["ahold"] = tset(s["ahold"], j, h); out.append(("hold", "approval", j, h))
            else:
                r = s["rounds"][j] + 1; s["rounds"] = tset(s["rounds"], j, r)
                stacked = q[1:]
                if stacked:
                    s["tip"] = tset(s["tip"], j, h); s["queue"] = tset(s["queue"], j, (h,))
                    s["pre"] = tset(s["pre"], j, s["pre"][j] | frozenset((t2, False) for t2 in stacked))
                    out.append(("unwind", j, h, stacked))
                if r > MAXR[j]:
                    s["queue"] = tset(s["queue"], j, ())
                    s["ahold"] = tset(s["ahold"], j, h); out.append(("hold", "approval", j, h))
                else:
                    s["corr"] = tset(s["corr"], j, h)
        return s, out
    if k == "Approve":
        j, t = ev[1], ev[2]
        if s["ahold"][j] == t:
            s["ahold"] = tset(s["ahold"], j, None); s["rounds"] = tset(s["rounds"], j, 0)
            if t + 1 <= T:
                s["live"] = tset(s["live"], j, s["live"][j] | {t + 1})
                s["pre"] = tset(s["pre"], j, s["pre"][j] - {(t + 1, True)})
            return s, [("approved", j, t)]
        return s, [("refuse",)]
    if k == "PreApprove":
        j, t, sb = ev[1], ev[2], ev[3]
        if not started(s, j, t) and not has_entry(s, j, t) and len(s["pre"][j]) < BACKLOG_MAX:
            s["pre"] = tset(s["pre"], j, s["pre"][j] | {(t, sb)})
            return s, [("preapproved", j, t, sb)]
        return s, [("refuse",)]
    if k == "BacklogRemove":
        j, t = ev[1], ev[2]
        if not started(s, j, t) and has_entry(s, j, t):
            s["pre"] = tset(s["pre"], j, s["pre"][j] - {(t, False), (t, True)})
            return s, [("removed", j, t)]
        return s, [("refuse",)]
    if k == "Waive":
        j, p = ev[1], ev[2]
        if p in s["qh"][j] and s["wv"][j] is None:
            s["qh"] = tset(s["qh"], j, s["qh"][j] - {p}); s["wv"] = tset(s["wv"], j, p)
            return s, [("waived", j, p)]
        return s, [("refuse",)]
    if k == "Swap":
        j = ev[1]
        s["roles"] = tset(s["roles"], j, "swap" if s["roles"][j] == "std" else "std")
        return s, [("roles", j, s["roles"][j])]
    pi = PROVS.index(ev[1])
    if k == "SpendDown":
        if not s["passed"][pi] and s["ovr"][pi] is None:
            s["ovr"] = tset(s["ovr"], pi, ev[2])
            return s, [("spenddown", ev[1], ev[2])]
        return s, [("refuse",)]
    if k == "SpendDownCancel":
        if s["ovr"][pi] is not None:
            s["ovr"] = tset(s["ovr"], pi, None)
            return s, [("spenddown_canceled", ev[1])]
        return s, [("refuse",)]
    if k in ("ResetSeen", "ManualReset"):
        s["per"] = tset(s["per"], pi, s["per"][pi] + 1)
        for j in PROJ: s["spend"] = tset(s["spend"], j * 2 + pi, 0)
        s["out"] = tset(s["out"], pi, 0); s["passed"] = tset(s["passed"], pi, False)
        s["ovr"] = tset(s["ovr"], pi, None)
        s["first"] = "x" if ev[1] == "c" else "c"
        out.append(("period", ev[1]))
        for j in PROJ:
            if ev[1] in s["qh"][j]:
                s["qh"] = tset(s["qh"], j, s["qh"][j] - {ev[1]}); out.append(("release", "quota", j, ev[1]))
        return s, out
    if k == "TimerPass":
        s["passed"] = tset(s["passed"], pi, True)
        if s["ovr"][pi] is not None and s["ovr"][pi] > U - RESERVE:   # rev 5.1: only a loosening one ends on the clock
            s["ovr"] = tset(s["ovr"], pi, None)
        return s, []
    if k == "Observe":
        for j in PROJ:
            if ev[1] in s["qh"][j] and rule1(s, pi):
                s["qh"] = tset(s["qh"], j, s["qh"][j] - {ev[1]}); out.append(("release", "quota", j, ev[1]))
        return s, out
    if k == "Outside":
        s["out"] = tset(s["out"], pi, s["out"][pi] + 1); return s, []
    raise ValueError(ev)


def events(s):
    evs = []
    for j in PROJ:
        if s["infl"][j] is None:
            evs.append(("Run", j))
        else:
            step = s["infl"][j][0]
            for o in (("ok",) if step != "review" else ("pass", "changes")):
                evs.append(("Exit", j, o, 1))
        for t in range(0, T + 1): evs.append(("Approve", j, t))
        for t in range(1, T + 1):
            evs.append(("PreApprove", j, t, False)); evs.append(("PreApprove", j, t, True))
            evs.append(("BacklogRemove", j, t))
        evs.append(("Waive", j, "c"))   # amendment 5: Waive on c only
        evs.append(("Swap", j))
    bnd = False
    for p in PROVS:
        pi = PROVS.index(p)
        if p == "c":   # amendment 3: spend-down on c only
            evs += [("SpendDown", p, SD_TIGHT), ("SpendDown", p, SD_LOOSE), ("SpendDownCancel", p)]
        evs.append(("Observe", p))
        if s["per"][pi] < PER_MAX:
            evs.append(("ResetSeen", p))   # amendment 3: no ManualReset
        else:
            bnd = True
        if not s["passed"][pi]: evs.append(("TimerPass", p))
        if p in OUT_PROVS and s["out"][pi] < OUT_MAX: evs.append(("Outside", p))
    return evs, bnd


def done(s):
    return all(s["tip"][j] == T and not s["queue"][j] and s["ahold"][j] is None and s["infl"][j] is None
               and s["corr"][j] is None for j in PROJ)


# ------------------------------------------------- stages5 monitor
# Written from M4's monitor and rules B1-B4; sees only events and outputs.
def mon_init():
    n = len(PROJ)
    return dict(spend=(0,) * (2 * n), out=(0, 0), per=(0, 0), passed=(False, False),
                sdper=(None, None), sdlvl=(None, None), first="c",
                roles=("std",) * n, flight=(None,) * n,
                queue=((),) * n, tip=(0,) * n, corr=(None,) * n, crs=(0,) * n,
                pre=(frozenset(),) * n,      # unused plain pre-approvals
                sbe=(frozenset(),) * n,      # unused stop-before entries
                live=(frozenset(),) * n,     # unused live approvals
                removed=(frozenset(),) * n,  # tranches withdrawn and not approved since (BR)
                ahold=(0,) * n, qh=(frozenset(),) * n, wv=(None,) * n)


def m_sd_active(m, pi):
    return m["sdper"][pi] is not None and m["sdper"][pi] == m["per"][pi] and \
        not (m["passed"][pi] and m["sdlvl"][pi] > U - RESERVE)   # rev 5.1: a tightening one outlasts the clock


def m_cap(m, pi): return m["sdlvl"][pi] if m_sd_active(m, pi) else U - RESERVE
def m_used(m, pi): return sum(m["spend"][j * 2 + pi] for j in PROJ) + m["out"][pi]
def m_rule1(m, pi): return (not m["passed"][pi]) and m_used(m, pi) + EST <= m_cap(m, pi)


def m_alloc(m, j, pi):
    return (m["spend"][j * 2 + pi] + EST <= CEIL[j]
            and sum(m["spend"][k * 2 + pi] for k in PROJ) + EST <= sum(ALLOC))


def m_rule2(m, j, pi):   # "rule 2 is skipped only for a loosening level"
    if m_sd_active(m, pi) and m["sdlvl"][pi] > U - RESERVE: return True
    return m_alloc(m, j, pi)


def m_client(m, j, step):
    edit = "c" if m["roles"][j] == "std" else "x"
    return edit if step != "review" else ("x" if edit == "c" else "c")


def m_started(m, j, t):
    f = m["flight"][j]
    return m["tip"][j] >= t or (f is not None and f[0] == "impl" and f[1] == t)


def m_candidates(m, j):
    # "an entry with stop-before is NOT an implement candidate"
    if m["corr"][j] is not None: return [("correct", m["corr"][j])]
    c = []
    if m["queue"][j]: c.append(("review", m["queue"][j][0]))
    nxt = m["tip"][j] + 1
    if nxt <= T and (nxt in m["pre"][j] or nxt in m["live"][j]) and len(m["queue"][j]) + 1 <= BOUND:
        c.append(("impl", nxt))
    c.sort(key=lambda cd: (0 if m_client(m, j, cd[0]) == m["first"] else 1, 0 if cd[0] == "review" else 1))
    return c


def check(m, ev, out):
    m = dict(m); v = []; k = ev[0]
    def bad(x): v.append(x)
    launches = [o for o in out if o[0] == "launch"]
    if k == "Run":
        j = ev[1]
        if m["flight"][j] is not None: bad("C1 run while in flight")
        cands = m_candidates(m, j)
        w = m["wv"][j]; m["wv"] = tset(m["wv"], j, None)   # "the next launch attempt consumes or expires it"
        expw = None
        if w is not None and m["ahold"][j] is None:
            wc = [cd for cd in cands if m_client(m, j, cd[0]) == w]
            if wc: expw = wc[0]
        exp_expire = w is not None and expw is None
        expd = [o for o in out if o[0] == "waiver_expired"]
        if exp_expire != bool(expd): bad("WV waiver neither used nor expired (or expired when usable)")
        if launches and launches[0][7]:
            _, j2, step, t, p, role, prof, wd = launches[0]
            if w is None: bad("WV waived launch without an armed waiver")
            elif p != w: bad("WV waived launch of another provider")
            elif expw != (step, t): bad("WV waived launch is not the first candidate of its provider")
            if len(launches) > 1: bad("C1 two launches")
            if [o for o in out if o[0] in ("hold", "suggest")]: bad("H1 hold created by a launching attempt")
            pi = PROVS.index(p)
            if step == "impl":
                if t not in m["pre"][j] and t not in m["live"][j]:
                    bad("SB implement launch on a stop-before entry alone" if t in m["sbe"][j] else "BK implement launch without an unused approval")
                if t in m["removed"][j] and t not in m["live"][j]: bad("BR implement launch of a withdrawn tranche")   # amendment 4
                m["pre"] = tset(m["pre"], j, m["pre"][j] - {t}); m["live"] = tset(m["live"], j, m["live"][j] - {t})
                m["sbe"] = tset(m["sbe"], j, m["sbe"][j] - {t})
            m["spend"] = tset(m["spend"], j * 2 + pi, m["spend"][j * 2 + pi] + EST)
            m["flight"] = tset(m["flight"], j, (step, t, pi, m["per"][pi]))
            return m, v
        if expw is not None: bad("WV usable waiver not used")
        exp = None; expq = None
        if m["ahold"][j] is None and m["flight"][j] is None:
            for cd in cands:
                p = m_client(m, j, cd[0]); pi = PROVS.index(p)
                if p in m["qh"][j]: continue
                if m_rule1(m, pi) and m_rule2(m, j, pi):
                    exp = cd; break
                if expq is None and not m_rule1(m, pi): expq = p
        if launches:
            if len(launches) > 1: bad("C1 two launches")
            _, j2, step, t, p, role, prof, wd = launches[0]
            pi = PROVS.index(p)
            if m["ahold"][j] is not None: bad("C1 launch under approval hold")
            if p in m["qh"][j]: bad("C1 launch under quota hold for its provider")
            if m["passed"][pi] or m_used(m, pi) + EST > m_cap(m, pi):
                bad("RS launch enters the reserve or uses a stale period")
            if not m_rule2(m, j, pi): bad("AL launch beyond ceiling or allocations")
            if m_sd_active(m, pi) and m["sdlvl"][pi] < U - RESERVE:
                if m_used(m, pi) + EST > m["sdlvl"][pi] or not m_alloc(m, j, pi):
                    bad("SD5 launch under a tightening spend-down beyond its level or rule 2")
            if p != m_client(m, j, step): bad("SW client does not follow owner-set roles")
            if prof != ("ro" if step == "review" else "edit") or role != ROLE[step]: bad("SW profile does not follow role")
            if step == "impl":
                if t not in m["pre"][j] and t not in m["live"][j]:
                    bad("SB implement launch on a stop-before entry alone" if t in m["sbe"][j] else "BK implement launch without an unused approval")
                if t in m["removed"][j] and t not in m["live"][j]: bad("BR implement launch of a withdrawn tranche")   # amendment 4
                if len(m["queue"][j]) + 1 > BOUND: bad("QB implement launch with a full queue")
                m["pre"] = tset(m["pre"], j, m["pre"][j] - {t}); m["live"] = tset(m["live"], j, m["live"][j] - {t})
                m["sbe"] = tset(m["sbe"], j, m["sbe"][j] - {t})
            if exp != (step, t): bad("ED launched step is not the first admissible candidate in deadline order")
            m["spend"] = tset(m["spend"], j * 2 + pi, m["spend"][j * 2 + pi] + EST)
            m["flight"] = tset(m["flight"], j, (step, t, pi, m["per"][pi]))
        else:
            if exp is not None: bad("K refused although a candidate is admissible")
        holds = [o for o in out if o[0] == "hold"]
        if launches and holds: bad("H1 hold created by a launching attempt")
        if len(holds) > 1: bad("H1 two holds in one attempt")
        if not launches:
            got = holds[0][3] if holds else None
            if got != expq: bad("ED quota hold not for the first candidate refused by rule 1")
            if got: m["qh"] = tset(m["qh"], j, m["qh"][j] | {got})
        return m, v
    if k == "Exit":
        j, o, cost = ev[1], ev[2], ev[3]
        step, t, pi, per = m["flight"][j]
        if per == m["per"][pi]:
            m["spend"] = tset(m["spend"], j * 2 + pi, m["spend"][j * 2 + pi] + cost - EST)
        m["flight"] = tset(m["flight"], j, None)
        holds = [x for x in out if x[0] == "hold" and x[1] == "approval"]
        unw = [x for x in out if x[0] == "unwind"]
        if step == "impl":
            m["tip"] = tset(m["tip"], j, t); m["queue"] = tset(m["queue"], j, m["queue"][j] + (t,))
            if len(m["queue"][j]) > BOUND: bad("QB queue above its bound")
        elif step == "correct":
            m["corr"] = tset(m["corr"], j, None)
        else:
            q = m["queue"][j]; h = q[0]
            if o == "pass":
                m["queue"] = tset(m["queue"], j, q[1:]); m["crs"] = tset(m["crs"], j, 0)
                nxt = h + 1
                # "creates the approval hold when the only approval for t is a stop-before entry"
                want = not (nxt <= T and (nxt in m["pre"][j] or nxt in m["live"][j] or m["tip"][j] >= nxt))
                if unw: bad("UW unwind on a passing review")
                if want and nxt in m["sbe"][j] and not holds: bad("SB approval hold missing for a stop-before entry")
            else:
                r = m["crs"][j] + 1; m["crs"] = tset(m["crs"], j, r)
                stacked = q[1:]
                if stacked:
                    if [x[3] for x in unw] != [stacked]: bad("UW unwind does not name exactly the stacked tranches")
                    m["tip"] = tset(m["tip"], j, h); m["queue"] = tset(m["queue"], j, (h,))
                    m["pre"] = tset(m["pre"], j, m["pre"][j] | frozenset(stacked))
                elif unw: bad("UW unwind with nothing stacked")
                want = r > MAXR[j]
                if want: m["queue"] = tset(m["queue"], j, ())
                else: m["corr"] = tset(m["corr"], j, h)
            if want and [x[3] for x in holds] != [h]: bad("BK approval hold missing")
            if not want and holds: bad("BK approval hold although the next tranche is approved")
            if want: m["ahold"] = tset(m["ahold"], j, h)
        if step != "review" and (holds or unw): bad("K unexpected output at exit")
        return m, v
    if k == "Approve":
        j, t = ev[1], ev[2]
        ok = m["ahold"][j] == t
        got = out == [("approved", j, t)]
        if ok and not got: bad("K matching approval refused")
        if got and not ok: bad("BK approval released a hold it does not name")
        if ok:
            m["ahold"] = tset(m["ahold"], j, None); m["crs"] = tset(m["crs"], j, 0)
            if t + 1 <= T:
                m["live"] = tset(m["live"], j, m["live"][j] | {t + 1})
                m["sbe"] = tset(m["sbe"], j, m["sbe"][j] - {t + 1})     # "consumes the entry"
                m["removed"] = tset(m["removed"], j, m["removed"][j] - {t + 1})
        return m, v
    if k == "PreApprove":
        j, t, sb = ev[1], ev[2], ev[3]
        entries = len(m["pre"][j]) + len(m["sbe"][j])
        ok = not m_started(m, j, t) and t not in m["pre"][j] and t not in m["sbe"][j] and entries < BACKLOG_MAX
        got = bool(out) and out[0][0] == "preapproved"
        if ok != got: bad("K pre-approval acceptance differs from the text")
        if got:
            if sb: m["sbe"] = tset(m["sbe"], j, m["sbe"][j] | {t})
            else: m["pre"] = tset(m["pre"], j, m["pre"][j] | {t})
            m["removed"] = tset(m["removed"], j, m["removed"][j] - {t})
        return m, v
    if k == "BacklogRemove":
        j, t = ev[1], ev[2]
        ok = not m_started(m, j, t) and (t in m["pre"][j] or t in m["sbe"][j])
        got = out == [("removed", j, t)]
        if ok != got: bad("K backlog removal acceptance differs from the text")
        if got:
            m["pre"] = tset(m["pre"], j, m["pre"][j] - {t}); m["sbe"] = tset(m["sbe"], j, m["sbe"][j] - {t})
            m["removed"] = tset(m["removed"], j, m["removed"][j] | {t})
        return m, v
    if k == "Waive":
        j, p = ev[1], ev[2]
        ok = p in m["qh"][j] and m["wv"][j] is None
        got = out == [("waived", j, p)]
        if ok != got: bad("K waiver acceptance differs from the text")
        if got:
            m["qh"] = tset(m["qh"], j, m["qh"][j] - {p}); m["wv"] = tset(m["wv"], j, p)
        return m, v
    if k == "Swap":
        j = ev[1]
        new = "swap" if m["roles"][j] == "std" else "std"
        if out != [("roles", j, new)]: bad("K owner swap not applied")
        m["roles"] = tset(m["roles"], j, new)
        return m, v
    for o in out:
        if o[0] == "launch": bad("C1 launch outside a launch attempt")
        if o[0] == "roles" or o[0] == "suggest": bad("SW roles changed without an owner command")
    pi = PROVS.index(ev[1])
    if k == "SpendDown":
        ok = not m["passed"][pi] and not m_sd_active(m, pi)
        got = out == [("spenddown", ev[1], ev[2])]
        if ok != got: bad("SD spend-down acceptance differs from the text")
        if got: m["sdper"] = tset(m["sdper"], pi, m["per"][pi]); m["sdlvl"] = tset(m["sdlvl"], pi, ev[2])
        return m, v
    if k == "SpendDownCancel":
        ok = m_sd_active(m, pi)
        got = out == [("spenddown_canceled", ev[1])]
        if ok != got: bad("SD spend-down cancel acceptance differs from the text")
        if got: m["sdper"] = tset(m["sdper"], pi, None)
        return m, v
    if k in ("ResetSeen", "ManualReset"):
        m["per"] = tset(m["per"], pi, m["per"][pi] + 1)
        for j in PROJ: m["spend"] = tset(m["spend"], j * 2 + pi, 0)
        m["out"] = tset(m["out"], pi, 0); m["passed"] = tset(m["passed"], pi, False)
        m["first"] = "x" if ev[1] == "c" else "c"
        rel = {o[2] for o in out if o[0] == "release"}
        for j in PROJ:
            if (ev[1] in m["qh"][j]) != (j in rel): bad("K quota release at a new period differs")
            m["qh"] = tset(m["qh"], j, m["qh"][j] - {ev[1]})
        return m, v
    if k == "Observe":
        rel = {o[2] for o in out if o[0] == "release"}
        for j in PROJ:
            want = ev[1] in m["qh"][j] and m_rule1(m, pi)
            if want != (j in rel): bad("K quota release on a reading differs")
            if want: m["qh"] = tset(m["qh"], j, m["qh"][j] - {ev[1]})
        return m, v
    if out: bad("K output on an environment event")
    if k == "TimerPass": m["passed"] = tset(m["passed"], pi, True)
    elif k == "Outside": m["out"] = tset(m["out"], pi, m["out"][pi] + 1)
    return m, v


def s_count(s, ev, out, cnt):
    for o in out:
        if o[0] == "launch":
            j, pi = o[1], PROVS.index(o[4])
            if o[7]:
                cnt["waived_launch"] += 1
                if not (rule1(s, pi) and rule2(s, j, pi)): cnt["waived_over_rules"] += 1
                if s["roles"][j] == "swap": cnt["waived_after_swap"] += 1
            if s["ovr"][pi] is not None and s["ovr"][pi] < U - RESERVE and not o[7]: cnt["tight_launch"] += 1
            if s["ovr"][pi] is not None and s["ovr"][pi] > U - RESERVE and not o[7] and \
                    s["spend"][j * 2 + pi] + EST > CEIL[j]: cnt["loose_skips_rule2"] += 1
            if o[2] == "impl" and s["queue"][j]: cnt["stacked_launch"] += 1
            if o[2] == "impl" and (o[3], True) in s["pre"][j]: cnt["sb_and_live_launch"] += 1
            if s["roles"][j] == "swap": cnt["swapped_launch"] += 1
        if o[0] == "waiver_expired": cnt["waiver_expired"] += 1
        if o[0] == "unwind": cnt["unwind"] += 1
        if o[0] == "removed": cnt["backlog_removed"] += 1
        if o[0] == "hold" and o[1] == "approval" and ev[0] == "Exit" and ev[2] == "pass" \
                and (o[3] + 1, True) in s["pre"][o[2]]: cnt["sb_hold"] += 1
        if o[0] == "approved" and (o[2] + 1, True) in s["pre"][o[1]]: cnt["sb_consumed"] += 1
    if ev[0] == "Run" and not any(o[0] == "launch" for o in out):
        j = ev[1]
        for cd in candidates(s, j):
            p = client(s["roles"][j], cd[0]); pi = PROVS.index(p)
            if s["ovr"][pi] is not None and s["ovr"][pi] < U - RESERVE and rule1(s, pi) and not rule2(s, j, pi) \
                    and p not in s["qh"][j] and s["ahold"][j] is None:
                cnt["tight_rule2_refusal"] += 1; break
    if ev[0] == "Exit" and ev[2] == "pass" and not any(o[0] == "hold" for o in out): cnt["preapproved_end"] += 1


S_CNT = ("waived_launch", "waived_over_rules", "waived_after_swap", "waiver_expired", "tight_launch",
         "loose_skips_rule2", "tight_rule2_refusal", "stacked_launch", "sb_and_live_launch", "swapped_launch",
         "unwind", "backlog_removed", "sb_hold", "sb_consumed", "preapproved_end")


# ---------------------------------------------------------------- search
def freeze(d): return tuple(d.values())


def main():
    if SCOPE == "grants51":
        F = dict(init=g_initial, minit=gm_init, events=g_events, decide=g_decide, check=g_check, done=g_done,
                 count=g_count, names=G_CNT, prog=("launch", "reconciled"))
    else:
        F = dict(init=initial, minit=mon_init, events=events, decide=decide, check=check, done=done,
                 count=s_count, names=S_CNT, prog=("launch", "approved"))
    s0, m0 = F["init"](), F["minit"]()
    k0 = (freeze(s0), freeze(m0))
    ids = {k0: 0}; par = [None]; sts = [s0]
    dq = deque([(s0, m0)]); n = 0; launches = 0
    violations = {}; edges = []; expanded = set(); bounded = set(); finished = set()
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
                ids[key] = len(par); par.append((kid, ev)); sts.append(s2)
                if not v: dq.append((s2, m2))
            prog = any(o[0] in F["prog"] for o in out)
            if prog or ids[key] != kid: edges.append((kid, ids[key], prog))
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
    for (a, b, prog) in edges: preds.setdefault(b, []).append(a)

    def reach(seed):
        good = set(seed)
        for (a, b, prog) in edges:
            if prog: good.add(a)
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
        print("DEADLOCK", sts[i]); print("   trace:", tr(i))
    sgood = reach(finished | {i for i in range(len(par)) if i not in expanded})
    sdead = [i for i in expanded if i not in sgood]
    print(f"strict liveness (no credit for BOUNDED): {len(sdead)} states")
    if not violations and not dead: print("no violations")


if __name__ == "__main__":
    main()
