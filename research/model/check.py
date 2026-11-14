"""AMENDMENT 1 (after run 1 timed out unbounded): monitor C6 counts
change-requesting reviews, not correction launches; a discarded
correction relaunched after a crash is not a new round.

Bounded model check of the supervisor design's hold/recovery rules.

GRAMMAR AND BOUNDS (fixed before the first run):
  Events: Run; Exit(cls) for cls in success, changes, rateLimited, failed;
  CommitDone; Crash (supervisor dies and restarts; the agent process dies);
  Tick; Expire(p) (an observation goes stale); Observe(p, allow|hold);
  Waive(p); Approve(t, r) for t in {current, other}, r in {hold revision, other};
  Reconcile(discard|accept|abandon); Release; Drift (user commits to HEAD).
  Providers: claude, codex. maxCorrectionRounds = 2. Tranches: 0..2
  (exploration stops after tranche 2 starts). Revisions capped at 6.
  Exhaustive BFS over reachable (model, monitor) states, deduplicated.

The model is decide() below, written from the design. The monitor checks
trace properties C1-C6 from events alone, keeping its own obligations; it
never reads model holds.
"""
from collections import deque

MAXR = 2
MAXREV = 6
P_OF = {"impl": "claude", "correct": "claude", "review": "codex"}

def initial():
    return dict(tranche=0, step="impl", rounds=0, holds=frozenset(),
                inflight=None,  # (step, stage, base) stage: running|succeeded
                quota=(("claude", "unknown"), ("codex", "unknown")),
                waiver=frozenset(), head=0, expected=0, rev=0)

def q(s, p): return dict(s["quota"])[p]
def setq(s, p, v):
    d = dict(s["quota"]); d[p] = v; s["quota"] = tuple(sorted(d.items()))

def nextrev(s):
    s["rev"] = min(s["rev"] + 1, MAXREV); return s["rev"]

def advance_after_success(s, step):
    if step in ("impl", "correct"):
        s["step"] = "review"
    else:  # review passed
        s["step"] = "done"
        s["holds"] |= {("approval", s["tranche"], s["expected"])}

def decide(s, ev):
    """Returns (new state, commands). Commands: 'launch', 'intent'."""
    s = dict(s); cmds = []
    k = ev[0]
    if k == "Run":
        if s["holds"] or s["inflight"] or s["step"] == "done":
            return s, cmds
        if s["head"] != s["expected"]:
            s["holds"] |= {("failure", "drift")}; return s, cmds
        p = P_OF[s["step"]]
        if q(s, p) != "allow" and p not in s["waiver"]:
            s["holds"] |= {("quota", p)}; return s, cmds
        s["waiver"] = s["waiver"] - {p}
        cmds += ["intent", "launch"]
        s["inflight"] = (s["step"], "running", s["expected"])
    elif k == "Exit":
        if not s["inflight"] or s["inflight"][1] != "running": return s, cmds
        step, _, base = s["inflight"]; cls = ev[1]
        if cls == "changes" and step != "review": cls = "failed"
        if cls == "success":
            if step == "review":
                s["inflight"] = None; advance_after_success(s, step)
            else:
                s["inflight"] = (step, "succeeded", base)
        elif cls == "changes":
            s["inflight"] = None; s["rounds"] += 1
            if s["rounds"] > MAXR: s["holds"] |= {("failure", "notConverged")}
            else: s["step"] = "correct"
        elif cls == "rateLimited":
            s["inflight"] = None; p = P_OF[step]; setq(s, p, "hold")
            s["holds"] |= {("quota", p)}
        else:
            s["inflight"] = None; s["holds"] |= {("failure", "op")}
    elif k == "CommitDone":
        if s["inflight"] and s["inflight"][1] == "succeeded":
            step = s["inflight"][0]; s["inflight"] = None
            r = nextrev(s); s["head"] = r; s["expected"] = r
            advance_after_success(s, step)
    elif k == "Crash":
        if s["inflight"]:
            s["holds"] |= {("uncertain",)}
            s["inflight"] = (s["inflight"][0], "unknown", s["inflight"][2])
        s["waiver"] = frozenset()
    elif k == "Tick":
        pass
    elif k == "Expire":
        if q(s, ev[1]) == "allow": setq(s, ev[1], "unknown")
    elif k == "Observe":
        p, v = ev[1], ev[2]; setq(s, p, v)
        if v == "allow": s["holds"] -= {("quota", p)}
    elif k == "Waive":
        p = ev[1]
        if ("quota", p) in s["holds"]:
            s["holds"] -= {("quota", p)}; s["waiver"] |= {p}
    elif k == "Approve":
        t, r = ev[1], ev[2]
        h = ("approval", t, r)
        if h in s["holds"]:
            s["holds"] -= {h}; s["tranche"] += 1
            s["step"] = "impl"; s["rounds"] = 0
    elif k == "Reconcile":
        if ("uncertain",) in s["holds"] and s["inflight"]:
            step, _, base = s["inflight"]; s["holds"] -= {("uncertain",)}
            s["inflight"] = None; res = ev[1]
            if res == "discard":
                s["head"] = base; s["expected"] = base
            elif res == "accept":
                r = nextrev(s); s["head"] = r; s["expected"] = r
                advance_after_success(s, step)
            else:  # abandon
                s["step"] = "done"
                s["holds"] |= {("approval", s["tranche"], s["expected"])}
    elif k == "Release":
        fs = {h for h in s["holds"] if h[0] == "failure"}
        if fs:
            h = sorted(fs)[0]; s["holds"] -= {h}
            if h[1] == "drift": s["expected"] = s["head"]
            if h[1] == "notConverged": s["rounds"] = 0
    elif k == "Drift":
        if not s["inflight"]:
            r = nextrev(s); s["head"] = r
    return s, cmds

def events(s):
    out = [("Run",), ("Exit", "success"), ("Exit", "changes"),
           ("Exit", "rateLimited"), ("Exit", "failed"), ("CommitDone",),
           ("Crash",), ("Tick",), ("Reconcile", "discard"),
           ("Reconcile", "accept"), ("Reconcile", "abandon"),
           ("Release",), ("Drift",)]
    for p in ("claude", "codex"):
        out += [("Expire", p), ("Observe", p, "allow"),
                ("Observe", p, "hold"), ("Waive", p)]
    for t in (s["tranche"], s["tranche"] + 1):
        for r in (s["expected"], s["expected"] + 1, s["head"]):
            out.append(("Approve", t, r))
    return out

# ---------------- monitor: obligations derived from events only ----------
def mon_init():
    return dict(finished_tranches=frozenset(),   # tranche ids ended, awaiting approval
                approved=frozenset(),            # tranche ids approved
                ended_rev={},                    # tranche -> revision at end (frozen dict)
                quota_ok=(("claude", False), ("codex", False)),
                waived=frozenset(), unsettled=False, inflight=0,
                crash_pending=False, fail_pending=False, corrections=0,
                cur=0)

def check(m, s_before, ev, s_after, cmds):
    """Return (new monitor, violation or None)."""
    m = dict(m); qok = dict(m["quota_ok"]); viol = None
    k = ev[0]
    if "launch" in cmds:
        p = P_OF[s_before["step"]]
        # C1: no launch with an unapproved finished tranche, unsettled crash,
        # unreleased failure, or quota not shown allowed/waived.
        if m["cur"] in m["finished_tranches"] and m["cur"] not in m["approved"]:
            viol = "C1 approval"
        if m["crash_pending"]: viol = "C1/C4 uncertain"
        if m["fail_pending"]: viol = "C1 failure"
        if not qok[p] and p not in m["waived"]: viol = "C1/C3 quota"
        # C4: intent precedes launch
        if cmds.index("intent") > cmds.index("launch"): viol = "C4 intent order"
        # C5
        if m["inflight"] >= 1: viol = "C5 two in flight"
        m["inflight"] = 1; m["waived"] = m["waived"] - {p}
        # C6 (amended 1): a correction launch is allowed only while the
        # number of change-requesting reviews in this tranche is <= MAXR.
        if s_before["step"] == "correct" and m["corrections"] > MAXR:
            viol = "C6 corrections"
    if k == "Exit" and m["inflight"] and s_before["inflight"] and s_before["inflight"][1] == "running":
        cls = ev[1]
        step = s_before["inflight"][0]
        if cls == "changes" and step != "review": cls = "failed"
        if cls == "success" and step != "review":
            pass  # still unsettled until commit
        else:
            m["inflight"] = 0
        if cls == "rateLimited": qok[P_OF[step]] = False
        if cls == "failed": m["fail_pending"] = True
        if cls == "changes":
            m["corrections"] = min(m["corrections"] + 1, MAXR + 1)
            if m["corrections"] > MAXR: m["fail_pending"] = True
    if k == "CommitDone" and s_before["inflight"] and s_before["inflight"][1] == "succeeded":
        m["inflight"] = 0
    if k == "Crash" and m["inflight"]:
        m["crash_pending"] = True; m["inflight"] = 0
    if k == "Crash": m["waived"] = frozenset()
    if k == "Reconcile" and m["crash_pending"]:
        m["crash_pending"] = False
    if k == "Expire": qok[ev[1]] = False
    if k == "Observe": qok[ev[1]] = (ev[2] == "allow")
    if k == "Waive" and ("quota", ev[1]) in s_before["holds"]:
        m["waived"] = m["waived"] | {ev[1]}
    if k == "Release": m["fail_pending"] = False
    # tranche end, observed from model output step transition to done
    if s_before["step"] != "done" and s_after["step"] == "done":
        m["finished_tranches"] = m["finished_tranches"] | {m["cur"]}
        er = dict(m["ended_rev"]); er[m["cur"]] = s_after["expected"]; m["ended_rev"] = er
    if k == "Approve":
        t, r = ev[1], ev[2]
        released = s_after["tranche"] != s_before["tranche"]
        # C2: release only on matching tranche and end revision
        if released and not (t == m["cur"] and t in m["finished_tranches"]
                              and dict(m["ended_rev"]).get(t) == r):
            viol = "C2 approval mismatch"
        if released:
            m["approved"] = m["approved"] | {t}; m["cur"] = t + 1
            m["corrections"] = 0
    # C3: ticks change nothing
    if k == "Tick" and s_after != s_before: viol = "C3 tick changed state"
    if k == "Release" and s_before["step"] != "done": pass
    m["quota_ok"] = tuple(sorted(qok.items()))
    if s_after["rounds"] == 0 and s_before["rounds"] > MAXR: m["corrections"] = 0
    return m, viol

def freeze(d):
    return tuple(sorted((k, tuple(sorted(v.items())) if isinstance(v, dict) else v)
                        for k, v in d.items()))

def main():
    s0, m0 = initial(), mon_init()
    seen = {(freeze(s0), freeze(m0))}
    dq = deque([(s0, m0, ())]); violations = {}; n = 0; launches = 0
    import time; t0=time.time()
    while dq:
        s, m, trace = dq.popleft(); n += 1
        if n % 200000 == 0: print(f"progress {n} states, frontier {len(dq)}, {time.time()-t0:.0f}s", flush=True)
        if s["tranche"] >= 2: continue
        for ev in events(s):
            s2, cmds = decide(s, ev)
            if "launch" in cmds: launches += 1
            m2, v = check(m, s, ev, s2, cmds)
            if v and v not in violations:
                violations[v] = trace + (ev,); print("FOUND", v, len(trace)+1, flush=True)
            key = (freeze(s2), freeze(m2))
            if key not in seen:
                seen.add(key); dq.append((s2, m2, trace + (ev,)))
    print(f"states explored: {n}; launch transitions: {launches}")
    if not violations: print("no violations")
    for v, t in violations.items():
        print(f"VIOLATION {v} (trace length {len(t)}):")
        for e in t: print("   ", e)

if __name__ == "__main__":
    main()
