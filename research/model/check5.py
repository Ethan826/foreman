"""AMENDMENT 5 (after run 6, scope stages5 under amendment 4: timed out at
280 s with 2,800,000 states and the frontier at 180,534, falling; no
violation reported). Change for scopes stages5 and queue5, fixed before
run 7: Waive is offered only for provider c (as SpendDown since
amendment 3). A waiver of c can still meet a candidate of x only (the
waiver expires) and a swap of roles (counter waived_after_swap).

AMENDMENT 4 (after run 5, scope stages5 under amendment 3, --stop: BR
violation after 109 states, trace Approve(0, 0); PreApprove(0, 1, no);
BacklogRemove(0, 1); Run(0) launches the implement step of tranche 1 on
the live approval given by Approve(0, 0) before the removal). The rule
says BacklogRemove "withdraws an unused entry"; a live approval is not a
backlog entry, and the model leaves it standing. Property BR as written
("no implement launch of t without a later approval") forbids this
launch. Resolution, fixed before run 6: BacklogRemove withdraws only the
backlog entry; a live approval of t given earlier still stands. BR is
restated: after BacklogRemove(j, t), no implement launch of t unless a
live approval of t stands or a later PreApprove of t was accepted. The
model is unchanged; the monitor's BR check is changed accordingly. The
design text must say which reading it means.

AMENDMENT 3 (after run 4, scope stages5: timed out at 280 s with
2,300,000 states and the frontier at 605,822, growing; one violation was
reported before the timeout: "BR implement launch of a withdrawn
tranche"; its trace was not printed because the run did not end).
Changes for scopes stages5 and queue5, fixed before run 5: (a) no
ManualReset event (in this model its effect is identical to ResetSeen;
M4 checks ManualReset); (b) SpendDown and SpendDownCancel only for
provider c (rule 2 binds under a tightening level on c, counter
tight_rule2_refusal). Run 5 is run with --stop to obtain the BR trace.

AMENDMENT 2 (after run 2, scope grants under amendment 1: timed out at
280 s with 4,500,000 states and the frontier near 1,000,000, level but
not falling; no violation reported). Changes for scope grants, fixed
before run 3: (a) only project 0's steps can overshoot (cost 1 or 2);
project 1's steps cost 1; (b) no TimerPass once the one allowed reset
has been seen (those states are BOUNDED and get liveness credit anyway;
QR is exercised in the first period). What scope grants no longer
covers: an overshoot by the project that can lose a race (project 1).

AMENDMENT 1 (after run 1, scope grants: timed out at 280 s with
2,900,000 states and the frontier at 2,604,231, still growing; no
violation reported). Changes for scope grants, fixed before run 2:
(a) crashes only for project 0 and lost races only for project 1 (at most
1 each); (b) ResetSeen is enabled only after TimerPass (a reading with a
new reset time is seen only once the old reset time has passed); (c) the
monitor's Charged and Finished records are sets, not ordered tuples (a
representation change: the ordered form split states by the order of
charges; no expectation changed). What scope grants no longer covers: a
crash of a project that has lost a race (a crash in the lost-race phase
is recovered by startup step (a), which also recovers a crash in the
granted phase, and that is still covered for project 0), and a new
period seen before the reset time passes.

Model check M5: the revision-5 rules of the agent supervisor design
(docs/plans/2026-11-14-agent-supervisor-design.md, revision 5). check4.py
(M4) is kept unchanged and still covers the revision-4 rules it checks.

GRAMMAR AND BOUNDS (fixed before the first run; amendments, if any, are
added above this header, labeled with before and after results).

House style as in M4: a pure decide(s, ev) -> (s, out); a monitor
check(m, ev, out) that never sees model state and whose expectations are
written from the revision-5 rules (quoted in the task brief of 2026-11-15,
sections A and B1-B4), not from decide; BFS over (model, monitor) states;
liveness by backward reachability; counters show that each rule is
exercised.

=== Scope "grants" (rule A: admission rule 1 with open grants) ===

One provider c, one window, fallback mode (rule 1 only). Projects 0 and
1 share the account; each has 2 operations (steps), each a launch of c.
Integer units: U = 5, reserve 1, cap 4, estimate EST = 1, actual step
cost 1 or 2. Bounds: outside usage at most 1 unit per period; at most 1
reset (ResetSeen); at most 1 lost race per project; at most 1 crash per
project. Observe(full), Observe(lagged) and Stale are unbounded (they are
idempotent on the state).

State. Ledger rows: Grant(g) carrying (project, operation, period), then
at most one of Charged(g, cost) or GrantCanceled(g). Project log per
operation: Intended(g), then Finished(g, cost). A reading: used, usable,
the set of settled grants it reflects, and the outside usage it saw.
Truth: outside usage, the costs of finished steps of the current period.
Holds: Quota (per project, rule-1 refusal) and Uncertain (per project).
Volatile per instance: the launch phase (granted, lost race, running,
finished-not-charged).

Events.
  Run(j)         a launch attempt of j (instance up, no phase, an operation
                 left): settle-first (a) cancel every open grant of j that no
                 Intended names, (b) charge every Finished without Charged;
                 then, if no Quota or Uncertain hold of j stands, admission:
                 launch (Grant, one atomic ledger transaction) only if the
                 reading is usable and level + EST <= cap, else refuse and
                 create a Quota hold. The whole attempt is one atomic step.
  Intend(j)      the compare-and-append of Intended succeeds.
  Race(j)        the compare-and-append loses (at most 1 per project).
  CancelLost(j)  the instance appends GrantCanceled for the lost grant.
  Finish(j, k)   the step ends; Finished carries cost k in {1, 2}.
  Charge(j)      the instance appends Charged from the Finished record.
  Crash(j)       the instance dies (volatile phase lost; logs survive).
  Start(j)       restart and startup recovery (a), (b), and (c): an
                 operation with Intended and no Finished gets an Uncertain
                 hold.
  Reconcile(j)   owner: charges the uncertain grant at EST, settles it, and
                 the operation counts as finished at cost EST (its step's
                 provider usage is taken to be EST, at this moment).
  ObserveFull    reading = outside + all finished costs of the period;
                 reflects every settled grant of the period.
  ObserveLagged  reading = outside + finished costs as of the last full
                 reading (worst case: omits steps ended since); reflects
                 exactly what the previous reading reflected.
  Outside        outside usage +1.
  Stale          the reading becomes unusable.
  TimerPass      the reset time passes: reading unusable, every Quota hold
                 released; readings of the old window stay unusable.
  ResetSeen      a new period: usage 0, a usable reading of it, nothing
                 reflected, Quota holds released if rule 1 allows.
  Any Observe releases every Quota hold if its new reading allows.

Level (the written rule): r.used + EST per open grant + cost per settled
grant that r does not reflect, over grants of the current period (a grant
belongs to the period of its Grant row, as in M4); canceled grants count
nothing.

Properties.
  RS5 at every launch: (sum of costs of settled grants of the current
      period + EST per open grant of the current period) + outside usage
      as of the last reading + EST <= cap.
  DC  the model launches exactly when the monitor's level rule allows.
  LK  after the settle-first step of every attempt of j and at the end of
      every Start(j), every open grant of j is Intended and not Finished
      (in flight or held Uncertain); no grant is both charged and
      canceled; none is charged twice; CancelLost appends the cancel.
  QR  after TimerPass releases Quota holds, no launch until ResetSeen.
  UK  no launch on an unusable reading.
  K   settle-first, recovery and release outputs match the text.
Liveness: from every expanded state a launch, a Reconcile or the end is
reachable (BOUNDED states, where the one reset is used, get credit;
strict liveness without that credit is reported for information).
Observe and Start are always enabled when meaningful.

=== Scope "stages5" (rules B1-B4 on M4's stages scope) ===

M4's scope "stages" (project 0, providers c and x, tranches 1..2, review
queue bound 2, maxCorrectionRounds 1, backlog of at most 2, role swap
offered, U = 8, reserve 2, step cost 1, outside usage at most 1 unit on c,
at most 1 reset per provider), with these changes, fixed now:
  - rates converged for both providers from the start (ledger mode), with
    allocation = ceiling = 2 per provider, so that rule 2 can bind under a
    tightening spend-down (M4's stages had rule 2 implied by rule 1);
  - spend-down levels: tightening 5 (below U - reserve = 6) and loosening
    7; rule 2 is skipped only under a loosening level;
  - SpendDownCancel(p): ends an active spend-down; refused if none;
  - PreApprove(j, t, sb) with sb in {no, yes}: an entry with stop-before
    is not an implement candidate; at a passing review of h the approval
    hold is created when h+1 is not started and has neither a live
    approval nor a non-stop-before entry; Approve(j, h) releases the hold,
    live-approves h+1 and consumes a stop-before entry for h+1; at most
    one entry per tranche; an unwind re-arms stacked tranches as plain
    (non-stop-before) entries, as in M4;
  - Waive(j, p): accepted only while Quota(p) stands for j and no waiver
    is armed for j; removes that hold and arms the waiver. The next
    Run(j) disarms it: if no approval hold stands and j has a candidate of
    provider p, the first such candidate in deadline order launches
    without rules 1 and 2 (still taking a grant at EST); otherwise the
    waiver expires (output) and the attempt proceeds as an ordinary one;
  - BacklogRemove(j, t): removes the entry for t (either kind); refused if
    t has started or no entry for t exists.
Scope "queue5": as stages5 but tranches 1..3, review-queue bound 1,
backlog of at most 1 (M4's queue1 bounds).

Properties: M4's RS, AL, QB, BK, SW, UW, ED, C1, K (the monitor of M4
with the changes above), plus
  SB  no implement launch of t on a stop-before entry alone; the approval
      hold appears exactly as stated; Approve consumes the entry.
  WV  a waived launch is of the waiver's provider and is the first
      candidate of that provider in deadline order; at most one waived
      launch per accepted Waive; a waiver never survives a launch attempt
      (an attempt that does not use it outputs its expiry).
  SD5 a launch under a tightening spend-down has used + EST <= the level
      and passes rule 2.
  BR  after BacklogRemove(j, t), no implement launch of t without a later
      approval of t (a live approval or a new PreApprove).
Liveness as in M4.
"""
from collections import deque
import sys, time

SCOPE = next((a for a in sys.argv[1:] if a in ("grants", "stages5", "queue5")), "grants")


def tset(tup, i, v):
    l = list(tup); l[i] = v; return tuple(l)


# =================================================================
# Scope "grants"
# =================================================================
G_PROJ = (0, 1); G_OPS = 2; G_U = 5; G_RES = 1; G_CAP = G_U - G_RES; EST = 1
G_COSTS = (1, 2); G_OUT_MAX = 1; G_PER_MAX = 1; G_RACE_MAX = (0, 1); G_CRASH_MAX = (1, 0)   # amendment 1: were 1 and 1 per project


def g_initial():
    return dict(up=(True, True), ph=(None, None), log=((None,) * G_OPS,) * 2, uh=(False, False),
                qh=(False, False), led=(), rused=0, rok=True, rrefl=frozenset(), rout=0,
                out=0, fin=0, fullfin=0, per=0, passed=False, races=(0, 0), crashes=(0, 0))


def g_level(s):
    lv = s["rused"]
    for g, (j, op, per, st, cost) in enumerate(s["led"]):
        if per != s["per"]: continue
        if st == "o": lv += EST
        elif st == "c" and g not in s["rrefl"]: lv += cost
    return lv


def g_allows(s): return s["rok"] and g_level(s) + EST <= G_CAP


def g_setrow(s, g, st, cost):
    r = s["led"][g]; s["led"] = tset(s["led"], g, (r[0], r[1], r[2], st, cost))


def g_settle(s, j, out):
    named = {e[1] for e in s["log"][j] if e is not None}
    for g, (jj, op, per, st, cost) in enumerate(s["led"]):
        if jj == j and st == "o" and g not in named:
            g_setrow(s, g, "x", 0); out.append(("cancel", g))
    for e in s["log"][j]:
        if e is not None and e[0] == "F" and s["led"][e[1]][3] == "o":
            g_setrow(s, e[1], "c", e[2]); out.append(("charge", e[1], e[2]))


def g_release(s, out, why):
    for j in G_PROJ:
        if s["qh"][j]:
            s["qh"] = tset(s["qh"], j, False); out.append(("release", "quota", j, why))


def g_decide(s, ev):
    s = dict(s); out = []; k = ev[0]
    if k == "Run":
        j = ev[1]
        g_settle(s, j, out)
        if s["uh"][j] or s["qh"][j]:
            out.append(("refuse",)); return s, out
        if g_allows(s):
            nop = sum(1 for e in s["log"][j] if e is not None)
            g = len(s["led"])
            s["led"] = s["led"] + ((j, nop, s["per"], "o", 0),)
            s["ph"] = tset(s["ph"], j, ("g", g))
            out.append(("launch", j, g)); return s, out
        s["qh"] = tset(s["qh"], j, True); out.append(("hold", "quota", j)); return s, out
    if k in ("Intend", "Race", "CancelLost", "Finish", "Charge"):
        j = ev[1]; ph, g = s["ph"][j]; op = s["led"][g][1]
        if k == "Intend":
            s["log"] = tset(s["log"], j, tset(s["log"][j], op, ("I", g)))
            s["ph"] = tset(s["ph"], j, ("r", g)); return s, [("intended", j, g)]
        if k == "Race":
            s["races"] = tset(s["races"], j, s["races"][j] + 1)
            s["ph"] = tset(s["ph"], j, ("l", g)); return s, []
        if k == "CancelLost":
            g_setrow(s, g, "x", 0); s["ph"] = tset(s["ph"], j, None); return s, [("cancel", g)]
        if k == "Finish":
            c = ev[2]
            s["log"] = tset(s["log"], j, tset(s["log"][j], op, ("F", g, c)))
            if s["led"][g][2] == s["per"]: s["fin"] += c
            s["ph"] = tset(s["ph"], j, ("f", g)); return s, [("finished", j, g, c)]
        if k == "Charge":
            c = s["log"][j][op][2]
            g_setrow(s, g, "c", c); s["ph"] = tset(s["ph"], j, None); return s, [("charge", g, c)]
    if k == "Crash":
        j = ev[1]
        s["up"] = tset(s["up"], j, False); s["ph"] = tset(s["ph"], j, None)
        s["crashes"] = tset(s["crashes"], j, s["crashes"][j] + 1); return s, []
    if k == "Start":
        j = ev[1]
        s["up"] = tset(s["up"], j, True)
        g_settle(s, j, out)
        for e in s["log"][j]:
            if e is not None and e[0] == "I" and not s["uh"][j]:
                s["uh"] = tset(s["uh"], j, True); out.append(("hold", "uncertain", j, e[1]))
        return s, out
    if k == "Reconcile":
        j = ev[1]
        for op, e in enumerate(s["log"][j]):
            if e is not None and e[0] == "I":
                g = e[1]
                s["log"] = tset(s["log"], j, tset(s["log"][j], op, ("F", g, EST)))
                g_setrow(s, g, "c", EST)
                if s["led"][g][2] == s["per"]: s["fin"] += EST
                out += [("reconciled", j, g), ("charge", g, EST)]
        s["uh"] = tset(s["uh"], j, False); return s, out
    if k == "ObserveFull":
        s["rused"] = s["out"] + s["fin"]; s["fullfin"] = s["fin"]; s["rout"] = s["out"]
        s["rok"] = not s["passed"]
        s["rrefl"] = frozenset(g for g, r in enumerate(s["led"]) if r[3] == "c" and r[2] == s["per"])
        if g_allows(s): g_release(s, out, "reading")
        return s, out
    if k == "ObserveLagged":
        s["rused"] = s["out"] + s["fullfin"]; s["rout"] = s["out"]; s["rok"] = not s["passed"]
        if g_allows(s): g_release(s, out, "reading")
        return s, out
    if k == "Outside":
        s["out"] += 1; return s, []
    if k == "Stale":
        s["rok"] = False; return s, []
    if k == "TimerPass":
        s["passed"] = True; s["rok"] = False
        g_release(s, out, "timer"); return s, out
    if k == "ResetSeen":
        s["per"] += 1; s["out"] = 0; s["fin"] = 0; s["fullfin"] = 0
        s["rused"] = 0; s["rrefl"] = frozenset(); s["rout"] = 0; s["rok"] = True; s["passed"] = False
        if g_allows(s): g_release(s, out, "reading")
        return s, out
    raise ValueError(ev)


def g_events(s):
    evs = []
    for j in G_PROJ:
        ph = s["ph"][j]
        if not s["up"][j]:
            evs.append(("Start", j))
        else:
            if ph is None and sum(1 for e in s["log"][j] if e is not None) < G_OPS:
                evs.append(("Run", j))
            elif ph is not None and ph[0] == "g":
                evs.append(("Intend", j))
                if s["races"][j] < G_RACE_MAX[j]: evs.append(("Race", j))
            elif ph is not None and ph[0] == "l":
                evs.append(("CancelLost", j))
            elif ph is not None and ph[0] == "r":
                for c in (G_COSTS if j == 0 else (1,)): evs.append(("Finish", j, c))   # amendment 2
            elif ph is not None and ph[0] == "f":
                evs.append(("Charge", j))
            if s["crashes"][j] < G_CRASH_MAX[j]: evs.append(("Crash", j))
        if s["uh"][j]: evs.append(("Reconcile", j))
    evs += [("ObserveFull",), ("ObserveLagged",)]
    if s["rok"]: evs.append(("Stale",))
    if s["out"] < G_OUT_MAX: evs.append(("Outside",))
    bnd = s["per"] >= G_PER_MAX
    if not s["passed"] and not bnd: evs.append(("TimerPass",))   # amendment 2
    if not bnd and s["passed"]: evs.append(("ResetSeen",))   # amendment 1: a new period is seen only after the reset time passes
    return evs, bnd


def g_done(s):
    return (all(s["up"][j] and s["ph"][j] is None and not s["uh"][j]
                and all(e is not None and e[0] == "F" for e in s["log"][j]) for j in G_PROJ)
            and all(r[3] != "o" for r in s["led"]))


# ---------------------------------------------------- grants monitor
# Written from rule A; sees only events and outputs.
def gm_init():
    return dict(up=(True, True), grants=(), charged=frozenset(), canceled=frozenset(), intended=frozenset(),
                finished=frozenset(), pend=(None, None), lost=(None, None), run=(None, None), fin_wait=(None, None),
                uh=(False, False), qh=(False, False), per=0, passed=False, out=0, fin=0, fullfin=0,
                rused=0, rok=True, rrefl=frozenset(), rout=0, timerflag=False)


def gm_charged(m): return dict(m["charged"])
def gm_finished(m): return dict(m["finished"])


def gm_open(m, g):
    return g not in gm_charged(m) and g not in m["canceled"]


def gm_level(m):   # "level = r.used + EST per open grant + cost per settled grant r does not reflect"
    lv = m["rused"]; ch = gm_charged(m)
    for g, (j, per) in enumerate(m["grants"]):
        if per != m["per"]: continue
        if gm_open(m, g): lv += EST
        elif g in ch and g not in m["rrefl"]: lv += ch[g]
    return lv


def gm_rule1(m): return m["rok"] and gm_level(m) + EST <= G_CAP


def gm_apply_rows(m, out, bad):
    for o in out:
        if o[0] == "cancel":
            g = o[1]
            if g in gm_charged(m): bad("LK grant both charged and canceled")
            m["canceled"] = m["canceled"] | {g}
        elif o[0] == "charge":
            g = o[1]
            if g in gm_charged(m): bad("LK grant charged twice")
            if g in m["canceled"]: bad("LK grant both charged and canceled")
            m["charged"] = m["charged"] | {(g, o[2])}


def gm_settle_expect(m, j):
    fin = gm_finished(m); ch = gm_charged(m)
    canc = {("cancel", g) for g, (jj, per) in enumerate(m["grants"])
            if jj == j and gm_open(m, g) and g not in m["intended"]}
    chg = {("charge", g, fin[g]) for g in fin if m["grants"][g][0] == j and g not in ch and g not in m["canceled"]}
    return canc | chg


def gm_lk(m, j, bad):
    fin = gm_finished(m)
    for g, (jj, per) in enumerate(m["grants"]):
        if jj == j and gm_open(m, g) and not (g in m["intended"] and g not in fin):
            bad("LK open grant of the project that is neither in flight nor held uncertain")


def g_check(m, ev, out):
    m = dict(m); v = []; k = ev[0]
    def bad(x): v.append(x)
    if k == "Run":
        j = ev[1]
        rows = [o for o in out if o[0] in ("cancel", "charge")]
        if set(rows) != gm_settle_expect(m, j) or len(rows) != len(set(rows)):
            bad("K settle-first differs from the text")
        gm_apply_rows(m, rows, bad)
        gm_lk(m, j, bad)
        blocked = m["uh"][j] or m["qh"][j]
        allow = (not blocked) and gm_rule1(m)
        launches = [o for o in out if o[0] == "launch"]
        holds = [o for o in out if o[0] == "hold"]
        if launches:
            g = launches[0][2]
            if not m["rok"]: bad("UK launch on an unusable reading")
            if m["timerflag"]: bad("QR launch after the reset-time release without a new reading")
            if blocked: bad("C launch under a hold")
            if not allow: bad("DC launch although the level rule refuses")
            ch = gm_charged(m)
            true = sum(ch[x] if x in ch else EST for x, (jj, per) in enumerate(m["grants"])
                       if per == m["per"] and x not in m["canceled"])
            if true + m["rout"] + EST > G_CAP: bad("RS5 launch with foreman usage + outside + EST above the cap")
            if g != len(m["grants"]): bad("K grant id")
            m["grants"] = m["grants"] + ((j, m["per"]),)
            m["pend"] = tset(m["pend"], j, g)
        else:
            if allow: bad("DC refused although the level rule allows")
            want = not blocked
            if want != bool(holds): bad("K quota hold at a rule-1 refusal differs")
            if holds: m["qh"] = tset(m["qh"], j, True)
        return m, v
    if k in ("Intend", "Race", "CancelLost", "Finish", "Charge"):
        j = ev[1]
        if not m["up"][j]: bad("C instance event while down")
        if k == "Intend":
            g = m["pend"][j]; m["pend"] = tset(m["pend"], j, None)
            m["intended"] = m["intended"] | {g}; m["run"] = tset(m["run"], j, g)
        elif k == "Race":
            m["lost"] = tset(m["lost"], j, m["pend"][j]); m["pend"] = tset(m["pend"], j, None)
        elif k == "CancelLost":
            g = m["lost"][j]; m["lost"] = tset(m["lost"], j, None)
            if ("cancel", g) not in out: bad("LK no cancel after a lost race")
            gm_apply_rows(m, out, bad)
        elif k == "Finish":
            g = m["run"][j]; c = ev[2]; m["run"] = tset(m["run"], j, None)
            m["finished"] = m["finished"] | {(g, c)}
            if m["grants"][g][1] == m["per"]: m["fin"] += c
            m["fin_wait"] = tset(m["fin_wait"], j, g)
        else:
            g = m["fin_wait"][j]; m["fin_wait"] = tset(m["fin_wait"], j, None)
            if out != [("charge", g, gm_finished(m)[g])]: bad("K charge does not carry the Finished cost")
            gm_apply_rows(m, out, bad)
        return m, v
    if k == "Crash":
        j = ev[1]; m["up"] = tset(m["up"], j, False)
        for f in ("pend", "lost", "run", "fin_wait"): m[f] = tset(m[f], j, None)
        if out: bad("K output at a crash")
        return m, v
    if k == "Start":
        j = ev[1]; m["up"] = tset(m["up"], j, True)
        rows = [o for o in out if o[0] in ("cancel", "charge")]
        if set(rows) != gm_settle_expect(m, j) or len(rows) != len(set(rows)):
            bad("K startup recovery (a)/(b) differs from the text")
        gm_apply_rows(m, rows, bad)
        fin = gm_finished(m)
        unc = {g for g, (jj, per) in enumerate(m["grants"]) if jj == j and g in m["intended"] and g not in fin}
        holds = {o[3] for o in out if o[0] == "hold"}
        if unc and not m["uh"][j] and holds != set(unc): bad("K uncertain hold at startup differs")
        if (not unc or m["uh"][j]) and holds: bad("K uncertain hold without an unfinished Intended")
        if holds: m["uh"] = tset(m["uh"], j, True)
        gm_lk(m, j, bad)
        return m, v
    if k == "Reconcile":
        j = ev[1]
        fin = gm_finished(m)
        unc = [g for g, (jj, per) in enumerate(m["grants"]) if jj == j and g in m["intended"] and g not in fin]
        want = [("reconciled", j, g) for g in unc] + [("charge", g, EST) for g in unc]
        if sorted(out) != sorted(want): bad("K reconcile differs from the text")
        for g in unc:
            m["finished"] = m["finished"] | {(g, EST)}
            if m["grants"][g][1] == m["per"]: m["fin"] += EST
        gm_apply_rows(m, [o for o in out if o[0] == "charge"], bad)
        m["uh"] = tset(m["uh"], j, False)
        return m, v
    # environment
    if k == "ObserveFull":
        m["rused"] = m["out"] + m["fin"]; m["fullfin"] = m["fin"]; m["rout"] = m["out"]; m["rok"] = not m["passed"]
        ch = gm_charged(m)
        m["rrefl"] = frozenset(g for g in ch if m["grants"][g][1] == m["per"])
    elif k == "ObserveLagged":
        m["rused"] = m["out"] + m["fullfin"]; m["rout"] = m["out"]; m["rok"] = not m["passed"]
    elif k == "Outside":
        m["out"] += 1
    elif k == "Stale":
        m["rok"] = False
    elif k == "TimerPass":
        m["passed"] = True; m["rok"] = False
    elif k == "ResetSeen":
        m["per"] += 1; m["out"] = 0; m["fin"] = 0; m["fullfin"] = 0; m["rused"] = 0
        m["rrefl"] = frozenset(); m["rout"] = 0; m["rok"] = True; m["passed"] = False; m["timerflag"] = False
    rel = {o[2] for o in out if o[0] == "release"}
    for j in G_PROJ:
        if k == "TimerPass": want = m["qh"][j]
        elif k in ("ObserveFull", "ObserveLagged", "ResetSeen"): want = m["qh"][j] and gm_rule1(m)
        else: want = False
        if want != (j in rel): bad("K quota release differs from the text")
        if want: m["qh"] = tset(m["qh"], j, False)
    if k == "TimerPass" and rel: m["timerflag"] = True
    if any(o[0] not in ("release",) for o in out): bad("K unexpected output on an environment event")
    return m, v


def g_count(s, ev, out, cnt):
    for o in out:
        if o[0] == "launch":
            if any(r[3] == "o" and r[0] != ev[1] and r[2] == s["per"] for r in s["led"]): cnt["launch_other_open"] += 1
            if any(r[3] == "c" and r[2] == s["per"] and g not in s["rrefl"] for g, r in enumerate(s["led"])): cnt["launch_unreflected_counted"] += 1
            if any(r[3] == "c" and r[2] == s["per"] and g in s["rrefl"] for g, r in enumerate(s["led"])): cnt["launch_reflected"] += 1
            if s["rused"] < s["out"] + s["fin"]: cnt["launch_on_lagged_reading"] += 1
        if o[0] == "hold" and o[1] == "quota":
            cnt["quota_hold_unusable" if not s["rok"] else "quota_hold_level"] += 1
        if o[0] == "hold" and o[1] == "uncertain": cnt["uncertain_hold"] += 1
        if o[0] == "release" and o[3] == "timer": cnt["timer_release"] += 1
        if ev[0] in ("Run", "Start") and o[0] == "cancel": cnt["settle_cancel"] += 1
        if ev[0] in ("Run", "Start") and o[0] == "charge": cnt["settle_charge"] += 1
    if ev[0] == "CancelLost": cnt["cancel_lost"] += 1
    if ev[0] == "Reconcile": cnt["reconcile"] += 1
    if ev[0] == "Finish" and ev[2] > EST: cnt["overshoot"] += 1
    if ev[0] == "Run" and not any(o[0] == "launch" for o in out) and s["rok"] and not s["qh"][ev[1]] \
            and not s["uh"][ev[1]] and s["rused"] + EST <= G_CAP:
        cnt["refused_by_grants_only"] += 1


G_CNT = ("launch_other_open", "launch_unreflected_counted", "launch_reflected", "launch_on_lagged_reading",
         "quota_hold_unusable", "quota_hold_level", "uncertain_hold", "timer_release", "settle_cancel",
         "settle_charge", "cancel_lost", "reconcile", "overshoot", "refused_by_grants_only")


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
        s["passed"] = tset(s["passed"], pi, True); s["ovr"] = tset(s["ovr"], pi, None)
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
    return m["sdper"][pi] is not None and m["sdper"][pi] == m["per"][pi] and not m["passed"][pi]


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
    if SCOPE == "grants":
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
