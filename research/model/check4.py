"""AMENDMENT 5 (after the second mutation pass, under amendment 4: 25 of 30
mutants killed). QB1 (queue bound off by one), BK1 (a pre-approval not
used by its launch) and BK2 (a passing review skips the hold whenever
anything is pre-approved) were missed in both scopes with the faithful
state counts: with two tranches the queue never holds more than two
entries, a stale pre-approval never fills a backlog of two, and no
pre-approval can exist for a tranche other than the next. Scope added,
fixed before run 9: "queue1", one project, tranches 1..3 (T = 3),
review-queue bound 1, backlog of at most 1, maxCorrectionRounds 1, role
swap offered, the stages constants otherwise (no Converge, outside usage
on Claude). Scopes ledger and stages are unchanged.

AMENDMENT 4 (after the first mutation pass, under amendment 3; faithful
runs: ledger 2,084,092 states, stages 933,192, no violations, liveness 0
in both). Mutants AL1 (ceiling ignored) and AL3 (foreman's use above the
sum of allocations) were missed in both scopes with state counts equal to
the faithful model's: with allocations (2, 2) and ceilings (3, 2), project
0 has no third Claude step to reach its ceiling, and project 1 cannot
exceed its allocation, so neither bound ever binds. Bound change for scope
ledger, fixed before run 7: allocations (1, 2), ceilings (2, 2) (the sum
of allocations 3 plus the reserve 2 stays within U = 6). Project 0 now
borrows on its correction after an exact-cost implement step, and hits
its ceiling on its correction after an overshooting one; project 1 can
use its whole allocation while project 0 borrows. The first mutation pass
was stopped and every mutant is rerun after this amendment.

AMENDMENT 3 (after run 4, scope stages under amendment 2: timed out at
280 s with 3,000,000 states and the frontier at 532,321, not falling; no
violation reported). Grammar changes for scope stages, fixed before run
5: (a) no Converge event: with one project whose allocation and ceiling
both equal U - reserve, rule 2 is implied by rule 1 (use(0) <= used), so
the rates' mode cannot change any decision there; rule 2 is checked in
scope ledger; (b) outside usage only on Claude's window, as in scope
ledger. Scope ledger is unchanged.

AMENDMENT 2 (after run 2 of scope ledger, under amendment 1: timed out
at 280 s with 2,200,000 states and the frontier at 1,285,917, still
growing; no violation reported). Bound changes for scope ledger, fixed
before run 3: (a) only Claude steps can overshoot (cost 1 or 2); Codex
steps cost 1; (b) outside usage only on Claude's window; (c)
maxCorrectionRounds is per project: project 0 (the borrower, ceiling 3)
keeps 1, project 1 has 0. Borrowing and spend-down launches need Claude
use above an allocation or above U - reserve, which (a)-(c) keep
reachable (counters borrow and sd_launch). What the ledger scope no
longer covers: Codex overshoot and outside usage on Codex (its rules are
the same functions of use as Claude's, per provider). Scope stages is
unchanged by this amendment except for the per-provider and per-project
form of the constants (same values).

AMENDMENT 1 (after run 1 of scope ledger: 2,451,648 states, 260,480
launch transitions, no violations, liveness 0, 208 s; but counters borrow
0 and sd_launch 0, so neither borrowing nor a launch above the reserve
under a spend-down was reachable: with maxCorrectionRounds 0 each project
makes one step per provider). Bound change for scope ledger, fixed before
run 2: maxCorrectionRounds 1 (a correction gives a project a second Claude
step and a second review). Counter quota_other_launch is 0 by
construction in scope ledger (bound 1 never offers two candidates at
once); it is meant for scope stages.

Model check M4: the revision-4 rules of the agent supervisor design
(docs/plans/2026-11-14-agent-supervisor-design.md, revision 4). check3.py
(M3) is kept unchanged and still covers the revision-3.1 rules.

GRAMMAR AND BOUNDS (fixed before the first run; amendments below are
labeled with before and after results).

What M4 models, and what it leaves to M3. M4 models the shared usage
ledger, the scheduler, the review queue, the pre-approved backlog and
role swaps. It does not model crashes, a second instance of one project,
protected changes, drift, git requests, failures, waivers or the
log-position check: M3 checks those, and they meet the new rules only
through "a hold exists" (every M4 launch is gated on the holds M4 has:
approval holds and per-provider quota holds) and through the request
machinery that the unwind reuses (M3's restore request; M4 performs an
unwind atomically). Arguments for that split are in the design's "Model
check M4" section. Ledger admissions are one SQLite BEGIN IMMEDIATE
transaction in the design and are atomic here; instances of different
projects interleave at every event.

Providers c (claude) and x (codex), one window each (rules 1 and 2 of the
admission rule are a conjunction over windows, and M3's quota scope
checks pacing over two windows). Usage is in integer units, U units =
100 percent. Every step's estimate is EST = 1 unit. Roles: "std"
(implementer and corrector c, reviewer x) or "swap" (the reverse).

Scope "ledger" (default): projects 0 and 1, each with one real tranche
(T = 1), review-queue bound 1, maxCorrectionRounds 0, no backlog, no role
swap. U = 6, reserve 2 (so the cap is 4), allocations (2, 2), ceilings
(3, 2) [amendments 1, 2 and 4 change these bounds; see above], spend-down level 5, step costs 1 or 2 (a step can overshoot its
estimate), outside usage at most 1 unit per period, at most 1 reset per
provider. Rules: reserve, allocations, borrowing, spend-down, periods,
convergence fallback, per-provider quota holds, EDF between two projects'
candidates of different providers.

Scope "stages": project 0 only, tranches 1..2 (T = 2), review-queue bound
2, maxCorrectionRounds 1, backlog of at most 2 pre-approvals, role swap
offered. U = 8, reserve 2, allocation 6, ceiling 6, spend-down level 7,
step cost 1, outside usage at most 1 unit, at most 1 reset per provider.
Rules: review queue and its bound, stacking and unwind, backlog and
approvals, swap by owner command, EDF within a project, quota holds per
provider, spend-down and periods.

Events. Run(j): project j's launch attempt (the scheduler). Exit(j, o, k):
the step in flight ends with outcome o (impl/correct: ok; review: pass or
changes) and cost k. Owner: Approve(j, t) for every t in 0..T; PreApprove
(j, t) for every t in 1..T (stages); Swap(j) (stages); SpendDown(p);
ManualReset(p). Environment: Outside(p); ResetSeen(p) (a reading with a
new reset time); TimerPass(p) (the clock passes the reset time);
Observe(p) (a fresh reading after a hold); Converge(p) (the rates of p
converge; one way).

MONITOR RULE: check(m, ev, out) never sees model state. Its expectations
are written from the design text (sections "Usage ledger", "Admission
rule", "Spend-down override", "Stages, review queue and scheduler",
"Pre-approved backlog", "Role-swap suggestions"), not from decide.

Properties (per transition):
  RS  reserve: a launch for provider p has used(p) + EST <= cap(p), where
      cap is the spend-down level while one is active for p's current
      period, else U - reserve; no launch for p after its reset time has
      passed and before a new period.
  AL  allocations: in ledger mode for p (rates converged) with no active
      spend-down, a launch of project j has use(j, p) + EST <= ceiling(j)
      and the sum of all projects' use + EST <= the sum of allocations.
  SD  a spend-down is accepted only with a usable reading and no active
      one; it is active only in the period it was recorded in and before
      that period's reset time (checked through RS: a launch above
      U - reserve needs an active spend-down by the monitor's own rule).
  PD  only ResetSeen and ManualReset open a period (use starts over);
      TimerPass only tightens (checked through RS and AL with the
      monitor's own period tracking).
  QB  the review queue never exceeds the bound; an implement step
      launches only with length + 1 <= bound.
  BK  every implement launch of tranche t is covered by an owner approval
      for t (a live approval of t-1's hold or a pre-approval of t) not
      already used by an earlier launch, an unwind arms it again; an
      approval hold is created at a passing review of the head tranche h
      exactly when h+1 is neither approved nor started, and always at
      notConverged; a hold is released only by Approve naming it.
  SW  every launch's client for its role follows the roles set by the
      last accepted owner Swap; the profile is editing exactly for the
      implementer and corrector.
  UW  a change request at the head unwinds exactly the tranches stacked
      above it.
  ED  the launched step is the first candidate in earliest-deadline
      order (deadline: provider reset order; ties to the review) that is
      not quota-held and passes admission; a refusal happens only when no
      candidate passes; a quota hold is created for the first candidate
      refused by rule 1, and only one per attempt.
  C1  no launch while an approval hold stands; no launch for p while a
      quota hold for p stands; one step in flight per project.
  K   completeness: accepted and refused owner commands match the text.
Liveness: from every expanded state a launch, an approval release or the
end of every project's last tranche is reachable. BOUNDED states (a
provider has used its one allowed reset) get credit; strict liveness
without that credit is reported for information, since a window used up
with no reset left legitimately waits.
"""
from collections import deque
import sys, time

SCOPE = next((a for a in sys.argv[1:] if a in ("ledger", "stages", "queue1")), "ledger")
PROVS = ("c", "x")
EST = 1
PER_MAX = 1
OUT_MAX = 1
if SCOPE == "ledger":
    PROJ = (0, 1); T = 1; BOUND = 1; MAXR = (1, 0); PRE = False; SWAP = False   # amendment 1: MAXR was 0; amendment 2: (1, 0)
    U = 6; RESERVE = 2; ALLOC = (1, 2); CEIL = (2, 2); SD = 5; COSTS = {"c": (1, 2), "x": (1,)}; OUT_PROVS = ("c",)   # amendment 2; amendment 4: ALLOC, CEIL were (2, 2), (3, 2)
elif SCOPE == "queue1":   # amendment 5
    PROJ = (0,); T = 3; BOUND = 1; MAXR = (1,); PRE = True; SWAP = True
    U = 8; RESERVE = 2; ALLOC = (6,); CEIL = (6,); SD = 7; COSTS = {"c": (1,), "x": (1,)}; OUT_PROVS = ("c",)
else:
    PROJ = (0,); T = 2; BOUND = 2; MAXR = (1,); PRE = True; SWAP = True
    U = 8; RESERVE = 2; ALLOC = (6,); CEIL = (6,); SD = 7; COSTS = {"c": (1,), "x": (1,)}; OUT_PROVS = ("c",)   # amendment 3: outside usage on c only
BACKLOG_MAX = 1 if SCOPE == "queue1" else 2   # amendment 5
ROLE = {"impl": "implementer", "correct": "corrector", "review": "reviewer"}


def client(roles, step):
    edit = "c" if roles == "std" else "x"
    return edit if step != "review" else ("x" if edit == "c" else "c")


def tset(tup, i, v):
    l = list(tup); l[i] = v; return tuple(l)


# ----------------------------------------------------------------- model
def initial():
    n = len(PROJ)
    return dict(tip=(0,) * n, queue=((),) * n, corr=(None,) * n, rounds=(0,) * n,
                ahold=(0,) * n, qh=(frozenset(),) * n, pre=(frozenset(),) * n,
                live=(frozenset(),) * n, roles=("std",) * n, infl=(None,) * n,
                spend=(0,) * (2 * n), out=(0, 0), per=(0, 0), passed=(False, False),
                ovr=(None, None), conv=(False, False), first="c")


def used(s, pi): return sum(s["spend"][j * 2 + pi] for j in PROJ) + s["out"][pi]
def cap(s, pi): return SD if s["ovr"][pi] is not None else U - RESERVE
def rule1(s, pi): return (not s["passed"][pi]) and used(s, pi) + EST <= cap(s, pi)


def rule2(s, j, pi):
    if not s["conv"][pi] or s["ovr"][pi] is not None:
        return True
    return (s["spend"][j * 2 + pi] + EST <= CEIL[j]
            and sum(s["spend"][k * 2 + pi] for k in PROJ) + EST <= sum(ALLOC))


def started(s, j, t):
    f = s["infl"][j]
    return s["tip"][j] >= t or (f is not None and f[0] == "impl" and f[1] == t)


def candidates(s, j):
    if s["corr"][j] is not None:
        return [("correct", s["corr"][j])]
    c = []
    q = s["queue"][j]
    if q: c.append(("review", q[0]))
    nxt = s["tip"][j] + 1
    if nxt <= T and (nxt in s["pre"][j] or nxt in s["live"][j]) and len(q) + 1 <= BOUND:
        c.append(("impl", nxt))
    return c


def edf(s, j, cands):
    def key(cd):
        return (0 if client(s["roles"][j], cd[0]) == s["first"] else 1, 0 if cd[0] == "review" else 1)
    return sorted(cands, key=key)


def decide(s, ev):
    s = dict(s); out = []; k = ev[0]
    if k == "Run":
        j = ev[1]
        if s["infl"][j] is not None or s["ahold"][j] is not None:
            return s, [("refuse",)]
        cands = edf(s, j, candidates(s, j))
        refused1 = None
        for cd in cands:
            p = client(s["roles"][j], cd[0]); pi = PROVS.index(p)
            if p in s["qh"][j]:
                continue
            if rule1(s, pi) and rule2(s, j, pi):
                s["spend"] = tset(s["spend"], j * 2 + pi, s["spend"][j * 2 + pi] + EST)
                if cd[0] == "impl":
                    s["pre"] = tset(s["pre"], j, s["pre"][j] - {cd[1]})
                    s["live"] = tset(s["live"], j, s["live"][j] - {cd[1]})
                s["infl"] = tset(s["infl"], j, (cd[0], cd[1], pi, s["per"][pi]))
                out.append(("launch", j, cd[0], cd[1], p, ROLE[cd[0]], "ro" if cd[0] == "review" else "edit"))
                return s, out
            if refused1 is None and not rule1(s, pi):
                refused1 = p
        if refused1 is not None:
            s["qh"] = tset(s["qh"], j, s["qh"][j] | {refused1})
            out.append(("hold", "quota", j, refused1))
            # role-swap suggestion (advisory): the other provider resets first and has headroom
            other = "x" if refused1 == "c" else "c"; oi = PROVS.index(other)
            if SWAP and s["first"] == other and rule1(s, oi):
                out.append(("suggest", j))
        if not out: out.append(("refuse",))
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
                if not (nxt <= T and (nxt in s["pre"][j] or nxt in s["live"][j] or started(s, j, nxt))):
                    s["ahold"] = tset(s["ahold"], j, h); out.append(("hold", "approval", j, h))
            else:
                r = s["rounds"][j] + 1; s["rounds"] = tset(s["rounds"], j, r)
                stacked = q[1:]
                if stacked:
                    s["tip"] = tset(s["tip"], j, h); s["queue"] = tset(s["queue"], j, (h,))
                    s["pre"] = tset(s["pre"], j, s["pre"][j] | frozenset(stacked))
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
            if t + 1 <= T: s["live"] = tset(s["live"], j, s["live"][j] | {t + 1})
            return s, [("approved", j, t)]
        return s, [("refuse",)]
    if k == "PreApprove":
        j, t = ev[1], ev[2]
        if not started(s, j, t) and t not in s["pre"][j] and len(s["pre"][j]) < BACKLOG_MAX:
            s["pre"] = tset(s["pre"], j, s["pre"][j] | {t})
            return s, [("preapproved", j, t)]
        return s, [("refuse",)]
    if k == "Swap":
        j = ev[1]
        s["roles"] = tset(s["roles"], j, "swap" if s["roles"][j] == "std" else "std")
        return s, [("roles", j, s["roles"][j])]
    pi = PROVS.index(ev[1]) if len(ev) > 1 else None
    if k == "SpendDown":
        if not s["passed"][pi] and s["ovr"][pi] is None:
            s["ovr"] = tset(s["ovr"], pi, s["per"][pi])
            return s, [("spenddown", ev[1])]
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
    if k == "Converge":
        s["conv"] = tset(s["conv"], pi, True); return s, []
    raise ValueError(ev)


def events(s):
    evs = []
    for j in PROJ:
        if s["infl"][j] is None:
            evs.append(("Run", j))
        else:
            step, pi = s["infl"][j][0], s["infl"][j][2]
            for o in (("ok",) if step != "review" else ("pass", "changes")):
                for c in COSTS[PROVS[pi]]: evs.append(("Exit", j, o, c))
        for t in range(0, T + 1): evs.append(("Approve", j, t))
        if PRE:
            for t in range(1, T + 1): evs.append(("PreApprove", j, t))
        if SWAP: evs.append(("Swap", j))
    bnd = False
    for p in PROVS:
        pi = PROVS.index(p)
        evs.append(("SpendDown", p)); evs.append(("Observe", p))
        if s["per"][pi] < PER_MAX:
            evs.append(("ResetSeen", p)); evs.append(("ManualReset", p))
        else:
            bnd = True
        if not s["passed"][pi]: evs.append(("TimerPass", p))
        if p in OUT_PROVS and s["out"][pi] < OUT_MAX: evs.append(("Outside", p))
        if not s["conv"][pi] and SCOPE == "ledger": evs.append(("Converge", p))   # amendment 3
    return evs, bnd


def done(s):
    return all(s["tip"][j] == T and not s["queue"][j] and s["ahold"][j] is None and s["infl"][j] is None
               and s["corr"][j] is None for j in PROJ)


# --------------------------------------------------------------- monitor
# Written from the design text; sees only events and outputs.
def mon_init():
    n = len(PROJ)
    return dict(spend=(0,) * (2 * n), out=(0, 0), per=(0, 0), passed=(False, False),
                sdper=(None, None), conv=(False, False), first="c",
                roles=("std",) * n, flight=(None,) * n,      # (step, t, pi, per)
                queue=((),) * n, tip=(0,) * n, corr=(None,) * n, crs=(0,) * n,
                pre=(frozenset(),) * n,      # tranches with an unused pre-approval (the backlog)
                live=(frozenset(),) * n,     # tranches with an unused live approval
                ahold=(0,) * n, qh=(frozenset(),) * n)


def m_sd_active(m, pi):   # "active only while the period key equals periodKey and the clock is before it"
    return m["sdper"][pi] is not None and m["sdper"][pi] == m["per"][pi] and not m["passed"][pi]


def m_used(m, pi): return sum(m["spend"][j * 2 + pi] for j in PROJ) + m["out"][pi]


def m_rule1(m, pi):
    capv = SD if m_sd_active(m, pi) else U - RESERVE
    return (not m["passed"][pi]) and m_used(m, pi) + EST <= capv


def m_rule2(m, j, pi):
    if not m["conv"][pi] or m_sd_active(m, pi): return True
    return (m["spend"][j * 2 + pi] + EST <= CEIL[j]
            and sum(m["spend"][k * 2 + pi] for k in PROJ) + EST <= sum(ALLOC))


def m_client(m, j, step):
    edit = "c" if m["roles"][j] == "std" else "x"
    return edit if step != "review" else ("x" if edit == "c" else "c")


def m_candidates(m, j):
    # "Candidates": correction first and alone; review of the head; implement of
    # the next approved tranche if the bound allows. Order: earliest deadline,
    # ties to the review.
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
        exp = None; expq = None
        if m["ahold"][j] is None and m["flight"][j] is None:
            for cd in m_candidates(m, j):
                p = m_client(m, j, cd[0]); pi = PROVS.index(p)
                if p in m["qh"][j]: continue
                if m_rule1(m, pi) and m_rule2(m, j, pi):
                    exp = cd; break
                if expq is None and not m_rule1(m, pi): expq = p
        if launches:
            if len(launches) > 1: bad("C1 two launches")
            _, j2, step, t, p, role, prof = launches[0]
            pi = PROVS.index(p)
            if m["ahold"][j] is not None: bad("C1 launch under approval hold")
            if p in m["qh"][j]: bad("C1 launch under quota hold for its provider")
            capv = SD if m_sd_active(m, pi) else U - RESERVE
            if m["passed"][pi] or m_used(m, pi) + EST > capv:
                bad("RS launch enters the reserve or uses a stale period")
            if not m_rule2(m, j, pi): bad("AL launch beyond ceiling or allocations")
            if p != m_client(m, j, step): bad("SW client does not follow owner-set roles")
            if prof != ("ro" if step == "review" else "edit") or role != ROLE[step]: bad("SW profile does not follow role")
            if step == "impl":
                if t not in m["pre"][j] and t not in m["live"][j]: bad("BK implement launch without an unused approval")
                if len(m["queue"][j]) + 1 > BOUND: bad("QB implement launch with a full queue")
                m["pre"] = tset(m["pre"], j, m["pre"][j] - {t}); m["live"] = tset(m["live"], j, m["live"][j] - {t})
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
        if per == m["per"][pi]:   # "a charge belongs to the period of its grant"
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
                want = not (nxt <= T and (nxt in m["pre"][j] or nxt in m["live"][j] or m["tip"][j] >= nxt))
                if unw: bad("UW unwind on a passing review")
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
            if t + 1 <= T: m["live"] = tset(m["live"], j, m["live"][j] | {t + 1})
        return m, v
    if k == "PreApprove":
        j, t = ev[1], ev[2]
        f = m["flight"][j]
        st = m["tip"][j] >= t or (f is not None and f[0] == "impl" and f[1] == t)
        ok = not st and t not in m["pre"][j] and len(m["pre"][j]) < BACKLOG_MAX
        got = bool(out) and out[0][0] == "preapproved"
        if ok != got: bad("K pre-approval acceptance differs from the text")
        if got: m["pre"] = tset(m["pre"], j, m["pre"][j] | {t})
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
        got = out == [("spenddown", ev[1])]
        if ok != got: bad("SD spend-down acceptance differs from the text")
        if got: m["sdper"] = tset(m["sdper"], pi, m["per"][pi])
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
    elif k == "Converge": m["conv"] = tset(m["conv"], pi, True)
    return m, v


# ---------------------------------------------------------------- search
def freeze(d): return tuple(d.values())


def main():
    s0, m0 = initial(), mon_init()
    k0 = (freeze(s0), freeze(m0))
    ids = {k0: 0}; par = [None]; sts = [s0]
    dq = deque([(s0, m0)]); n = 0; launches = 0
    violations = {}; edges = []; expanded = set(); bounded = set(); finished = set()
    cnt = dict(borrow=0, sd_launch=0, unwind=0, stacked_launch=0, preapproved_end=0, swapped_launch=0,
               suggest=0, quota_other_launch=0, fallback_launch=0, overshoot=0)
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
        if done(s):
            finished.add(kid); continue
        evs, bnd = events(s)
        expanded.add(kid)
        if bnd: bounded.add(kid)
        for ev in evs:
            s2, out = decide(s, ev)
            for o in out:
                if o[0] == "launch":
                    launches += 1; j, pi = o[1], PROVS.index(o[4])
                    if s["conv"][pi] and s["ovr"][pi] is None and s["spend"][j * 2 + pi] + EST > ALLOC[j]: cnt["borrow"] += 1
                    if s["ovr"][pi] is not None and used(s, pi) + EST > U - RESERVE: cnt["sd_launch"] += 1
                    if o[2] == "impl" and s["queue"][j]: cnt["stacked_launch"] += 1
                    if s["roles"][j] == "swap": cnt["swapped_launch"] += 1
                    if s["qh"][j]: cnt["quota_other_launch"] += 1
                    if not s["conv"][pi]: cnt["fallback_launch"] += 1
                if o[0] == "unwind": cnt["unwind"] += 1
                if o[0] == "suggest": cnt["suggest"] += 1
            if ev[0] == "Exit" and ev[3] > EST: cnt["overshoot"] += 1
            if ev[0] == "Exit" and ev[2] == "pass" and not any(o[0] == "hold" for o in out) and PRE: cnt["preapproved_end"] += 1
            m2, v = check(m, ev, out)
            key = (freeze(s2), freeze(m2))
            if key not in ids:
                ids[key] = len(par); par.append((kid, ev)); sts.append(s2)
                if not v: dq.append((s2, m2))
            prog = any(o[0] in ("launch", "approved") for o in out)
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
    print(f"liveness: states with no path to a launch, an approval release or the end: {len(dead)}")
    for i in sorted(dead)[:4]:
        print("DEADLOCK", sts[i]); print("   trace:", tr(i))
    sgood = reach(finished | {i for i in range(len(par)) if i not in expanded})
    sdead = [i for i in expanded if i not in sgood]
    print(f"strict liveness (no credit for BOUNDED): {len(sdead)} states")
    if not violations and not dead: print("no violations")


if __name__ == "__main__":
    main()
