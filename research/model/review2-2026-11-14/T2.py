"""AMENDMENT 3 (after run 5 and the first mutation pass). Bound change:
a state is not expanded once tranche 3 starts (was 2), so two real
tranches run. Reason: mutants M13, N8 and N17 change behavior only in the
tranche after an approval, which the old bound never explored. Run 5
(bound 2): 161,088 states, no violations, liveness and strict liveness 0.
Also adds two reachability counters (instrumentation over model states,
used only to argue mutant equivalence, never by the monitor): the
largest number of holds present at once, and states where an armed
waiver names a provider other than the current step's.

AMENDMENT 2 (after run 2, under amendment 1, timed out at 400,000
states, frontier 122,091, no violation reported by then). Bound change,
fixed before run 3: revisions 0..3 (was 0..5). Three commits still cover
the longest cycle without user commits (implement plus two corrections);
paths that need a fourth revision end in BOUNDED states, which count as
able to progress in the liveness check. Grammar unchanged.

AMENDMENT 1 (after run 1 timed out at 400,000 states, frontier 247,855,
no violation reported by then). Grammar changes, fixed before run 2:
  (a) Instance B runs atomically: RunB = read and append with no event in
      between (requires the lock). Instance A keeps the split ReadA /
      AppendA, and ReadA is offered only while no operation is in flight
      and A has no pending read. Two Run sources remain; the position check
      is exercised by A, the lock by B.
  (b) Readings collapse to allow / notAllow per provider. A hold reading
      and an expired or absent reading have the same effect on pacing
      (neither allows), so Observe(p, hold, *) is merged into Expire(p),
      which now means "p's newest usable reading does not allow".
      Observe(p, allow, fresh) and Observe(p, allow, stale) remain.
Bounds unchanged.

Bounded model check of the supervisor design, revision 2.

Model check M2 for docs/plans/2026-11-14-agent-supervisor-design.md
(revision 2). check.py (M1) and review-2026-11-14/ are kept unchanged.

GRAMMAR AND BOUNDS (fixed before the first run)
-----------------------------------------------
Events (each enabled as stated; user commands are always offered, and the
model may refuse them):
  ReadA, ReadB      a `run` instance folds the log and computes a launch
                    decision (no append). One pending read per instance.
  AppendA, AppendB  that instance appends the decision. The append succeeds
                    only if the instance holds the lock and nothing was
                    appended since its read; otherwise it is dropped.
  StartA, StartB    an instance starts and takes the free lock; startup
                    recovery runs (Uncertain hold for an orphaned operation).
  Crash             the lock holder dies; its agent dies with it; lock freed.
  Exit(kind)        the running agent exits. Mutating steps (impl, correct):
                    changed, nochange, protected, rateLimited, failed.
                    Review: success, changes, rateLimited, failed.
                    Mutating rateLimited/failed exits leave the tree dirty
                    (worst case). A review never dirties the tree.
  ShellCommit       the shell's commit procedure after a successful mutating
                    exit: refuses if HEAD moved from the step's base, else
                    `git commit` lands (HEAD := new revision).
  CommitFail        `git commit` fails (git error).
  CommitDone        the shell appends Committed(revision).
  UserCommit        the user commits (HEAD := new revision, tree clean), at
                    any time, including while an agent runs.
  UserEdit          the user (or anything outside the log) dirties the tree.
  Observe(p, v, fresh)  an observation for provider p with pacing verdict v in
                    {allow, hold}; fresh = observedAt postdates the provider's
                    latest Quota hold (False models a stale reading that
                    arrives late, finding S1).
  Expire(p)         p's newest reading passes freshness or resetsAt.
  Tick              time passes.
  Waive(p)          user `waive p`.
  Approve(t, r, a)  user `approve t r`, a = allow protected paths in the next
                    tranche; t in {tranche, tranche+1}, r in {expected, head,
                    rev+1}, a in {False, True}.
  Reconcile(res)    res in {discard, accept, abandon} (accept = HEAD).
  Release           user `release` of the failure hold.
  Adopt, Restore    user `adopt` / `restore` of the drift hold.
Providers: claude (impl, correct), codex (review).
maxCorrectionRounds = 2. Tranche 0 is the start hold; tranche 1 runs; a
state is not expanded once tranche 2 starts. Revisions 0..5: an event that
would create revision 6 is disabled and its source state is marked
BOUNDED. Exhaustive BFS over reachable (model, monitor) states,
deduplicated. A violating transition is reported and not expanded.

MONITOR RULE: the monitor (mon_* functions) never reads model state. Its
inputs are the event and the outputs decide() returns for that event (the
appended records and shell commands). Its signature enforces this:
check(m, ev, out). Revisions it needs come from event arguments
(UserCommit(r)) or outputs (gitcommit r).

Properties (monitor, per transition):
  C1  no launch while the monitor holds any obligation (approval pending,
      uncertain, failure, drift, quota for the step's provider).
  C2  an approval release names the tranche that ended and its end revision.
  C3  Tick produces no output; an observation releases a quota obligation
      only if it is fresh (postdates the hold) and allows.
  C4  intent precedes launch in one append; after a crash with an operation
      in flight, no launch until a reconcile resolves it.
  C5  at most one operation in flight.
  C6  a correction launch happens only after 1..maxCorrectionRounds
      change-requesting reviews in the tranche; after maxCorrectionRounds+1
      the tranche has ended (approval obligation), so nothing launches.
  C7  a launch whose provider's newest reading is not allow carries a
      waiver armed since the last launch attempt and not expired.
  D   no launch while the recorded revision differs from HEAD or the tree
      is dirty; the launch base is the recorded revision.
  E   the launched step is the next step of the cycle.
  K   completeness: a fresh append by the lock holder with no obligation
      launches; a matching approval is not refused; every release output
      matches a monitor-side justification and vice versa.
  P   no commit lands for an operation that changed a protected path in a
      tranche whose approval did not allow it.
Liveness (after BFS): every expanded state can reach a launch or an
approval release (tranche advance). States marked BOUNDED and unexpanded
boundary states count as able to progress. Liveness assumes the
environment can still offer an allowing observation (or the user waives).
"""
from collections import deque
import sys, time

MAXR = 2
MAXREV = 3   # amendment 2 (was 5)
LAST_TRANCHE = 3   # amendment 3 (was 2)
P_OF = {"impl": "claude", "correct": "claude", "review": "codex"}
PROVS = ("claude", "codex")
MUTATING = ("impl", "correct")


def initial():
    return dict(tranche=0, step="done", rounds=0,
                holds=frozenset({("approval", 0, 0)}),
                inflight=None,      # (step, stage, base, r) stage running|exited|gitcommitted
                orphan=False,
                q=(("claude", "no"), ("codex", "no")),
                waiver=None, head=0, expected=0, dirty=False, rev=0,
                allowp=False, ghost=False, lock="A", pend=(("A", None), ("B", None)))


def getq(s, p): return dict(s["q"])[p]
def setq(s, p, v):
    d = dict(s["q"]); d[p] = v; s["q"] = tuple(sorted(d.items()))
def getpend(s, i): return dict(s["pend"])[i]
def setpend(s, i, v):
    d = dict(s["pend"]); d[i] = v; s["pend"] = tuple(sorted(d.items()))


def newrev(s):
    s["rev"] += 1; return s["rev"]


def end_tranche(s, out, why):
    s["step"] = "done"
    h = ("approval", s["tranche"], s["expected"])
    s["holds"] |= {h}; out.append(("hold", h, why))


# ---------------- model: the design's decide() and shell ----------------
def decide_run(s):
    """Launch decision on a folded state: returns a delta."""
    if s["inflight"]:
        return ("noop",)
    if s["holds"]:
        return ("refuse",)
    if s["head"] != s["expected"] or s["dirty"]:
        return ("hold", ("drift",))
    p = P_OF[s["step"]]
    if s["waiver"] == p:
        return ("launch", s["step"], s["expected"], True)
    if getq(s, p) == "allow":
        return ("launch", s["step"], s["expected"], False)
    return ("hold", ("quota", p))


def apply_run(s, d, out):
    if d[0] == "noop":
        return
    s["waiver"] = None                      # any launch attempt consumes or expires it
    if d[0] == "refuse":
        out.append(("refused",)); return
    if d[0] == "hold":
        s["holds"] |= {d[1]}; out.append(("refused",)); out.append(("hold", d[1], "run"))
        return
    _, step, base, waived = d
    s["inflight"] = (step, "running", base, None); s["orphan"] = False
    out.append(("intent", step, base, waived)); out.append(("launch", step, base, waived))


def decide(s, ev):
    s = dict(s); out = []
    k = ev[0]
    if k in ("ReadA", "ReadB"):
        i = k[-1]
        setpend(s, i, (False, None))   # the read decision is recomputed at append (mutant N11 stores it)
    elif k == "RunB":
        if s["lock"] == "B":
            apply_run(s, decide_run(s), out)
    elif k in ("AppendA", "AppendB"):
        i = k[-1]; pd = getpend(s, i); setpend(s, i, None)
        if s["lock"] == i and not pd[0]:
            apply_run(s, decide_run(s), out)
    elif k in ("StartA", "StartB"):
        i = k[-1]
        if s["lock"] is None:
            s["lock"] = i; out.append(("started", i))
            if ((s["inflight"] and s["orphan"]) or s["ghost"]) and ("uncertain",) not in s["holds"]:
                s["holds"] |= {("uncertain",)}; out.append(("hold", ("uncertain",), "startup"))
    elif k == "Crash":
        if s["lock"]:
            setpend(s, s["lock"], None); s["lock"] = None
            s["waiver"] = None
            if s["inflight"]: s["orphan"] = True
    elif k == "Exit":
        step, stage, base, _ = s["inflight"]; kind = ev[1]; p = P_OF[step]
        out.append(("finished", kind))
        if step in MUTATING:
            if kind == "changed" or (kind == "protected" and s["allowp"]):
                s["dirty"] = True; s["inflight"] = (step, "exited", base, None)
            elif kind == "nochange":
                s["inflight"] = None; s["step"] = "review"; out.append(("nothing",))
            elif kind == "protected":
                s["dirty"] = True; s["inflight"] = None
                s["holds"] |= {("failure",)}; out.append(("hold", ("failure",), "protected"))
            elif kind == "rateLimited":
                s["dirty"] = True; s["inflight"] = None; setq(s, p, "no")
                s["holds"] |= {("quota", p)}; out.append(("hold", ("quota", p), "rateLimited"))
            else:
                s["dirty"] = True; s["inflight"] = None
                s["holds"] |= {("failure",)}; out.append(("hold", ("failure",), "failed"))
        else:
            s["inflight"] = None
            if kind == "success":
                end_tranche(s, out, "passed")
            elif kind == "changes":
                s["rounds"] = min(s["rounds"] + 1, MAXR + 1)
                if s["rounds"] > MAXR: end_tranche(s, out, "notConverged")
                else: s["step"] = "correct"
            elif kind == "rateLimited":
                setq(s, p, "no")
                s["holds"] |= {("quota", p)}; out.append(("hold", ("quota", p), "rateLimited"))
            else:
                s["holds"] |= {("failure",)}; out.append(("hold", ("failure",), "failed"))
    elif k == "ShellCommit":
        step, stage, base, _ = s["inflight"]
        if s["head"] != base:
            s["inflight"] = None
            s["holds"] |= {("failure",)}; out.append(("hold", ("failure",), "headMoved"))
        else:
            r = newrev(s); s["head"] = r; s["dirty"] = False
            s["inflight"] = (step, "gitcommitted", base, r); out.append(("gitcommit", r))
    elif k == "CommitFail":
        s["inflight"] = None
        s["holds"] |= {("failure",)}; out.append(("hold", ("failure",), "commitFailed"))
    elif k == "CommitDone":
        step, stage, base, r = s["inflight"]
        s["inflight"] = None; s["expected"] = r; s["step"] = "review"
        out.append(("committed", r))
    elif k == "UserCommit":
        s["head"] = ev[1]; s["rev"] = ev[1]; s["dirty"] = False
    elif k == "UserEdit":
        s["dirty"] = True
    elif k == "Observe":
        p, v, fresh = ev[1], ev[2], ev[3]
        setq(s, p, v); out.append(("observed", p, v, fresh))
        if v == "allow" and fresh and ("quota", p) in s["holds"]:
            s["holds"] -= {("quota", p)}; out.append(("release", ("quota", p)))
    elif k == "Expire":
        setq(s, ev[1], "no")
    elif k == "Tick":
        pass
    elif k == "Waive":
        p = ev[1]
        if ("quota", p) in s["holds"]:
            s["holds"] -= {("quota", p)}; s["waiver"] = p
            out.append(("release", ("quota", p))); out.append(("waived", p))
    elif k == "Approve":
        t, r, a = ev[1], ev[2], ev[3]
        h = ("approval", t, r)
        if h in s["holds"]:
            s["holds"] -= {h}; s["tranche"] = t + 1
            s["step"] = "impl"; s["rounds"] = 0; s["allowp"] = a
            out.append(("approved", t, r, a))
    elif k == "Reconcile":
        res = ev[1]
        if ("uncertain",) in s["holds"] and s["inflight"]:
            step, stage, base, _ = s["inflight"]; s["ghost"] = True
            if res == "discard":
                s["holds"] -= {("uncertain",)}; s["inflight"] = None
                s["head"] = base; s["expected"] = base; s["dirty"] = False
                out.append(("reconciled", res)); out.append(("reset", base))
            elif res == "accept" and step in MUTATING:
                s["holds"] -= {("uncertain",)}; s["inflight"] = None
                s["expected"] = s["head"]; s["step"] = "review"
                out.append(("reconciled", res)); out.append(("accepted", s["head"]))
            elif res == "abandon":
                s["holds"] -= {("uncertain",)}; s["inflight"] = None
                s["head"] = base; s["expected"] = base; s["dirty"] = False
                out.append(("reconciled", res)); out.append(("reset", base))
                end_tranche(s, out, "abandoned")
    elif k == "Release":
        if ("failure",) in s["holds"]:
            s["holds"] -= {("failure",)}; out.append(("release", ("failure",)))
    elif k == "Adopt":
        if ("drift",) in s["holds"] and not s["dirty"]:
            s["holds"] -= {("drift",)}; s["expected"] = s["head"]
            out.append(("release", ("drift",))); out.append(("adopted", s["head"]))
    elif k == "Restore":
        if ("drift",) in s["holds"]:
            s["holds"] -= {("drift",)}; s["head"] = s["expected"]; s["dirty"] = False
            out.append(("release", ("drift",))); out.append(("reset", s["expected"]))
    # any append marks the other instances' pending reads stale
    if k not in NONAPPEND:
        for i in ("A", "B"):
            pd = getpend(s, i)
            if pd is not None and not (k in ("ReadA", "ReadB") and k[-1] == i):
                setpend(s, i, (True, pd[1]))
    return s, out


NONAPPEND = {"Tick", "Expire", "UserCommit", "UserEdit", "ReadA", "ReadB"}


def events(s):
    """Environment and user events enabled in s (environment modelling may
    read model state; the monitor may not). Returns (events, bounded)."""
    out = []; bounded = False
    if getpend(s, "A") is not None: out.append(("AppendA",))
    elif not s["inflight"]: out.append(("ReadA",))
    out += [("RunB",), ("StartA",), ("StartB",)]
    out.append(("Crash",))
    inf = s["inflight"]
    if inf and not s["orphan"]:
        if inf[1] == "running":
            kinds = (("changed", "nochange", "protected", "rateLimited", "failed")
                     if inf[0] in MUTATING else ("success", "changes", "rateLimited", "failed"))
            out += [("Exit", kd) for kd in kinds]
        elif inf[1] == "exited":
            if s["rev"] < MAXREV or s["head"] != inf[2]: out.append(("ShellCommit",))
            else: bounded = True
            out.append(("CommitFail",))
        elif inf[1] == "gitcommitted":
            out.append(("CommitDone",))
    if s["rev"] < MAXREV: out.append(("UserCommit", s["rev"] + 1))
    else: bounded = True
    out += [("UserEdit",), ("Tick",), ("Release",), ("Adopt",), ("Restore",)]
    out += [("Reconcile", r) for r in ("discard", "accept", "abandon")]
    for p in PROVS:
        out += [("Expire", p), ("Waive", p)]
        out += [("Observe", p, "allow", f) for f in (True, False)]
    for t in (s["tranche"], s["tranche"] + 1):
        for r in sorted({s["expected"], s["head"], s["rev"] + 1}):
            for a in (False, True):
                out.append(("Approve", t, r, a))
    return out, bounded


# ---------------- monitor: events and outputs only ----------------
def mon_init():
    return dict(tr=0, step="done", rounds=0, ended=True, ended_rev=0, allowp=False,
                q=(("claude", "no"), ("codex", "no")),
                qob=frozenset(), waiver=None,
                infl=None,           # (step, base, phase, r) phase running|exited|gitcommitted
                crash_ob=False, fail_ob=False, drift_ob=False,
                head=0, exp=0, dirty=False, lock="A", orphan=False,
                view=(("A", None), ("B", None)))   # None | "fresh" | "stale"


def mget(m, key, i): return dict(m[key])[i]
def mset(m, key, i, v):
    d = dict(m[key]); d[i] = v; m[key] = tuple(sorted(d.items()))


def mon_expected_run(m):
    """What a fresh append by the lock holder must do, per the design text."""
    if m["infl"]: return ("noop",)
    if m["ended"] or m["crash_ob"] or m["fail_ob"] or m["drift_ob"] or m["qob"]:
        return ("refuse",)
    if m["head"] != m["exp"] or m["dirty"]: return ("hold", ("drift",))
    p = P_OF[m["step"]]
    if m["waiver"] == p: return ("launch", m["step"], m["exp"], True)
    if mget(m, "q", p) == "allow": return ("launch", m["step"], m["exp"], False)
    return ("hold", ("quota", p))


def check(m, ev, out):
    m = dict(m); v = []
    k = ev[0]; was_ended = m["ended"]
    kinds = [o[0] for o in out]
    def bad(x): v.append(x)
    launch = [o for o in out if o[0] == "launch"]
    releases = [o[1] for o in out if o[0] == "release"]
    if launch:
        if k not in ("AppendA", "AppendB", "RunB"): bad("C1 launch outside an append")
        _, step, base, waived = launch[0]; p = P_OF.get(step)
        if "intent" not in kinds or kinds.index("intent") > kinds.index("launch"): bad("C4 intent order")
        if m["infl"]: bad("C5 two in flight")
        if m["ended"]: bad("C1 approval pending")
        if m["crash_ob"] or m["orphan"]: bad("C4 uncertain pending")
        if m["fail_ob"]: bad("C1 failure pending")
        if m["drift_ob"]: bad("C1 drift pending")
        if p in m["qob"]: bad("C1 quota pending")
        if mget(m, "q", p) != "allow" and m["waiver"] != p: bad("C7 launch without allow or waiver")
        if waived and m["waiver"] != p: bad("C7 waiver recorded but not armed")
        if m["head"] != m["exp"] or m["dirty"]: bad("D launch on drifted or dirty tree")
        if base != m["exp"]: bad("D launch base differs from recorded revision")
        if step != m["step"]: bad("E wrong step %s expected %s" % (step, m["step"]))
        if step == "correct" and not (1 <= m["rounds"] <= MAXR): bad("C6 corrections")
    # --- per event
    if k in ("ReadA", "ReadB"):
        if out: bad("K read appended")
        mset(m, "view", k[-1], "fresh")
    elif k in ("AppendA", "AppendB", "RunB"):
        i = k[-1]
        fresh = m["lock"] == i and (k == "RunB" or mget(m, "view", i) == "fresh")
        mset(m, "view", i, None)
        exp = mon_expected_run(m) if fresh else ("noop",)
        if exp[0] == "noop":
            if out: bad("K append when none allowed")
        else:
            m["waiver"] = None
            if exp[0] == "refuse":
                if out != [("refused",)]: bad("K refusal expected, got %s" % (out,))
            elif exp[0] == "hold":
                if exp[1] == ("drift",): m["drift_ob"] = True
                else: m["qob"] = m["qob"] | {exp[1][1]}
                if out != [("refused",), ("hold", exp[1], "run")]: bad("K hold %s expected, got %s" % (exp[1], out))
            else:
                if not launch: bad("K launch expected, got %s" % (out,))
                m["infl"] = (exp[1], exp[2], "running", None)
    elif k in ("StartA", "StartB"):
        if m["lock"] is None:
            m["lock"] = k[-1]
            if "started" not in kinds: bad("K start refused")
            if m["orphan"] and not m["crash_ob"]:
                m["crash_ob"] = True
                if ("hold", ("uncertain",), "startup") not in out: bad("C4 startup did not hold the orphan")
        elif out: bad("K second instance started while lock held")
    elif k == "Crash":
        if m["lock"]:
            mset(m, "view", m["lock"], None); m["lock"] = None; m["waiver"] = None
            if m["infl"]: m["orphan"] = True
    elif k == "Exit":
        if not m["infl"] or m["infl"][2] != "running" or m["orphan"]:
            bad("C5 exit of an operation the monitor did not see running")
        else:
            step, base, _, _ = m["infl"]; kind = ev[1]; p = P_OF[step]
            if step in MUTATING:
                if kind == "changed" or (kind == "protected" and m["allowp"]):
                    m["dirty"] = True; m["infl"] = (step, base, "exited", None)
                elif kind == "nochange":
                    m["infl"] = None; m["step"] = "review"
                elif kind == "rateLimited":
                    m["dirty"] = True; m["infl"] = None; mset(m, "q", p, "no"); m["qob"] = m["qob"] | {p}
                else:  # failed, or protected without permission
                    m["dirty"] = True; m["infl"] = None; m["fail_ob"] = True
            else:
                m["infl"] = None
                if kind == "success":
                    m["ended"] = True; m["ended_rev"] = m["exp"]; m["step"] = "done"
                elif kind == "changes":
                    m["rounds"] = min(m["rounds"] + 1, MAXR + 1)
                    if m["rounds"] > MAXR:
                        m["ended"] = True; m["ended_rev"] = m["exp"]; m["step"] = "done"
                    else: m["step"] = "correct"
                elif kind == "rateLimited":
                    mset(m, "q", p, "no"); m["qob"] = m["qob"] | {p}
                else: m["fail_ob"] = True
    elif k == "ShellCommit":
        gc = [o[1] for o in out if o[0] == "gitcommit"]
        if not m["infl"] or m["infl"][2] != "exited":
            if gc: bad("P commit for an operation without a permitted successful exit")
        elif m["head"] != m["infl"][1]:
            if gc: bad("D commit on a moved HEAD")
            m["infl"] = None; m["fail_ob"] = True
        else:
            if not gc: bad("K commit refused on unchanged HEAD")
            else:
                m["head"] = gc[0]; m["dirty"] = False
                m["infl"] = m["infl"][:2] + ("gitcommitted", gc[0])
    elif k == "CommitFail":
        if m["infl"] and m["infl"][2] == "exited":
            m["infl"] = None; m["fail_ob"] = True
    elif k == "CommitDone":
        if not m["infl"] or m["infl"][2] != "gitcommitted":
            bad("K Committed recorded without a landed commit")
        else:
            r = m["infl"][3]
            if ("committed", r) not in out: bad("K Committed revision differs")
            m["exp"] = r; m["infl"] = None; m["step"] = "review"
    elif k == "UserCommit":
        m["head"] = ev[1]; m["dirty"] = False
    elif k == "UserEdit":
        m["dirty"] = True
    elif k == "Observe":
        p, val, fresh = ev[1], ev[2], ev[3]
        mset(m, "q", p, val)
        if val == "allow" and fresh and p in m["qob"]:
            m["qob"] = m["qob"] - {p}
            if ("quota", p) not in releases: bad("K fresh allow did not release")
        elif releases: bad("C3 observation released a hold without a fresh allow")
    elif k == "Expire":
        mset(m, "q", ev[1], "no")
    elif k == "Tick":
        if out: bad("C3 tick produced output")
    elif k == "Waive":
        p = ev[1]
        if p in m["qob"]:
            m["qob"] = m["qob"] - {p}; m["waiver"] = p
            if ("waived", p) not in out: bad("K waiver refused")
        elif out: bad("C7 waiver without quota hold")
    elif k == "Approve":
        t, r, a = ev[1], ev[2], ev[3]
        ok = m["ended"] and t == m["tr"] and r == m["ended_rev"]
        if "approved" in kinds and not ok: bad("C2 approval mismatch")
        if ok and "approved" not in kinds: bad("K matching approval refused")
        if ok:
            m["tr"] = t + 1; m["step"] = "impl"; m["rounds"] = 0
            m["ended"] = False; m["allowp"] = a
    elif k == "Reconcile":
        res = ev[1]
        ok = m["crash_ob"] and m["infl"] and (res != "accept" or m["infl"][0] in MUTATING)
        if "reconciled" in kinds and not ok: bad("C4 unjustified reconcile")
        if ok and "reconciled" not in kinds: bad("K reconcile refused")
        if ok:
            step, base = m["infl"][0], m["infl"][1]
            m["crash_ob"] = False; m["orphan"] = False; m["infl"] = None
            if res in ("discard", "abandon"):
                if ("reset", base) not in out: bad("K reset to wrong base")
                m["head"] = base; m["exp"] = base; m["dirty"] = False
                if res == "abandon":
                    m["ended"] = True; m["ended_rev"] = base; m["step"] = "done"
            else:
                m["exp"] = m["head"]; m["step"] = "review"
    elif k == "Release":
        if m["fail_ob"]:
            m["fail_ob"] = False
            if ("failure",) not in releases: bad("K release refused")
        elif releases: bad("K unjustified release")
    elif k == "Adopt":
        if m["drift_ob"] and not m["dirty"]:
            m["drift_ob"] = False; m["exp"] = m["head"]
            if ("adopted", m["head"]) not in out: bad("K adopt refused or wrong revision")
        elif out: bad("D unjustified adopt")
    elif k == "Restore":
        if m["drift_ob"]:
            m["drift_ob"] = False; m["head"] = m["exp"]; m["dirty"] = False
            if ("reset", m["exp"]) not in out: bad("K restore refused or wrong revision")
        elif out: bad("D unjustified restore")
    # tranche ends must agree with the monitor
    ends = [o for o in out if o[0] == "hold" and o[1][0] == "approval"]
    newly = m["ended"] and not was_ended
    if ends and not (newly and ends[0][1] == ("approval", m["tr"], m["ended_rev"])):
        bad("C6/C2 tranche ended when the monitor did not end it")
    if newly and not ends:
        bad("K tranche end missing")
    # stale marking of other views on any append
    if k not in NONAPPEND:
        for i in ("A", "B"):
            if mget(m, "view", i) == "fresh" and not (k in ("ReadA", "ReadB") and k[-1] == i):
                mset(m, "view", i, "stale")
    return m, v


def freeze(d):
    return tuple(sorted(d.items()))


def main():
    s0, m0 = initial(), mon_init()
    k0 = (freeze(s0), freeze(m0))
    ids = {k0: 0}; par = [None]; sts = [s0]
    dq = deque([(s0, m0)]); n = 0; launches = 0
    violations = {}; edges = []; expanded = set(); bounded = set()
    maxholds = 0; waivmis = 0
    t0 = time.time()

    def tr(i):
        o = []
        while par[i] is not None: i, e = par[i]; o.append(e)
        return tuple(reversed(o))
    while dq:
        s, m = dq.popleft(); n += 1
        kid = ids[(freeze(s), freeze(m))]
        if n % 200000 == 0:
            print(f"progress {n} states, frontier {len(dq)}, {time.time()-t0:.0f}s", flush=True)
        if s["tranche"] >= LAST_TRANCHE: continue
        expanded.add(kid)
        maxholds = max(maxholds, len(s["holds"]))
        if s["waiver"] and s["step"] in P_OF and P_OF[s["step"]] != s["waiver"]: waivmis += 1
        evs, bnd = events(s)
        if bnd: bounded.add(kid)
        for ev in evs:
            s2, out = decide(s, ev)
            if any(o[0] == "launch" for o in out): launches += 1
            m2, v = check(m, ev, out)
            key = (freeze(s2), freeze(m2))
            if key not in ids:
                ids[key] = len(par); par.append((kid, ev)); sts.append(s2)
                if not v: dq.append((s2, m2))
            prog = any(o[0] in ("launch", "approved") for o in out)
            edges.append((kid, ids[key], prog))
            for x in v:
                if x.split()[0] not in violations:
                    violations[x.split()[0]] = (x, kid, ev)
                    print("FOUND", x, flush=True)
                    if "--stop" in sys.argv:
                        print(f"stopped at first violation after {n} states")
                        for e in tr(kid) + (ev,): print("   ", e)
                        return
    print(f"states explored: {n}; launch transitions: {launches}; bounded states: {len(bounded)}; {time.time()-t0:.0f}s")
    print(f"most holds at once: {maxholds}; states with a waiver for another provider's step: {waivmis}")

    for name, (x, kid, ev) in violations.items():
        print(f"VIOLATION {x}:")
        for e in tr(kid) + (ev,): print("   ", e)
    # liveness
    preds = {}; good = set(bounded)
    for i in range(len(par)):
        if i not in expanded: good.add(i)
    for (a, b, prog) in edges:
        preds.setdefault(b, []).append(a)
        if prog: good.add(a)
    work = list(good)
    while work:
        x = work.pop()
        for y in preds.get(x, []):
            if y not in good: good.add(y); work.append(y)
    dead = [i for i in expanded if i not in good]
    print(f"liveness: states with no path to a launch or approval release: {len(dead)}")
    shown = set()
    for i in sorted(dead):
        s = sts[i]
        sig = (tuple(sorted(s["holds"])), s["step"], s["inflight"] and s["inflight"][1])
        if sig in shown: continue
        shown.add(sig)
        print("DEADLOCK", {k: s[k] for k in ("holds", "step", "inflight", "head", "expected", "dirty", "lock")})
        print("   trace:", tr(i))
        if len(shown) >= 6: break
    # strict variant: BOUNDED states get no credit; a state counted here can
    # progress only through a transition the revision bound disabled
    sgood = {i for i in range(len(par)) if i not in expanded}
    for (a_, b_, prog) in edges:
        if prog: sgood.add(a_)
    work = list(sgood)
    while work:
        x = work.pop()
        for y in preds.get(x, []):
            if y not in sgood: sgood.add(y); work.append(y)
    sdead = [i for i in expanded if i not in sgood]
    print(f"strict liveness (no credit for BOUNDED): {len(sdead)} states")
    shown = set()
    for i in sorted(sdead):
        s = sts[i]
        sig = (tuple(sorted(s["holds"])), s["step"], s["inflight"] and s["inflight"][1], s["head"] == s["expected"], s["dirty"])
        if sig in shown: continue
        shown.add(sig)
        print("STRICT", {k: s[k] for k in ("holds", "step", "inflight", "head", "expected", "dirty", "rev")})
        print("   trace:", tr(i))
        if len(shown) >= 5: break
    if not violations and not dead: print("no violations")


if __name__ == "__main__":
    main()
