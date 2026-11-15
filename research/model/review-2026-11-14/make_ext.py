import pathlib, sys
src = pathlib.Path("orig.py").read_text()
def rep(a, b):
    global src
    assert src.count(a) == 1, a
    src = src.replace(a, b)
HDR = '''"""AMENDMENT 2 (review copy, not the foreman file; grammar and bounds fixed
before running). Adds to the grammar of amendment 1:
  GitCommit: the shell's git commit lands (HEAD moves) after a successful
    implement/correct exit; CommitDone (the Committed event) is now a separate
    later event, so Crash between them is reachable.
  Reconcile(acceptHead): accept(revision) naming the current HEAD.
  RELEASE mode (argv[1]): 'adopt' = the original model (Release(drift) sets
    expected := HEAD, Release(notConverged) resets rounds); 'literal' = the
    design text (Release removes the hold and nothing else).
  Monitor additions: D (no launch while HEAD differs from the revision the
    event log last recorded, tracked by the monitor from events and the
    observed HEAD at launch); C6 without the reset that reads model rounds.
  Liveness (new, after BFS): every reachable state with tranche < 2 must be
  able to reach a launch or an approval release by some event sequence;
  states that cannot are reported as deadlocks with a trace.
rounds saturates at MAXR+1 (only `> MAXR` is ever tested, so this abstraction is exact).\nExploration stops at a violating transition (its successors are not expanded).
Bounds unchanged: tranches 0..2, revisions capped at 6, maxCorrectionRounds 2.
"""
'''
src = HDR + src
rep('from collections import deque', 'from collections import deque\nimport sys\nMODE = sys.argv[1] if len(sys.argv) > 1 else "adopt"')
# split commit: GitCommit moves HEAD, CommitDone records
rep('''    elif k == "CommitDone":
        if s["inflight"] and s["inflight"][1] == "succeeded":
            step = s["inflight"][0]; s["inflight"] = None
            r = nextrev(s); s["head"] = r; s["expected"] = r
            advance_after_success(s, step)''',
'''    elif k == "GitCommit":
        if s["inflight"] and s["inflight"][1] == "succeeded":
            r = nextrev(s); s["head"] = r
            s["inflight"] = (s["inflight"][0], "gitcommitted", s["inflight"][2])
    elif k == "CommitDone":
        if s["inflight"] and s["inflight"][1] == "gitcommitted":
            step = s["inflight"][0]; s["inflight"] = None
            s["expected"] = s["head"]
            advance_after_success(s, step)''')
rep('''            elif res == "accept":''', '''            elif res == "acceptHead":
                s["expected"] = s["head"]
                if step == "review": advance_after_success(s, step)
                else: s["step"] = "review"
            elif res == "accept":''')
rep('''            if h[1] == "drift": s["expected"] = s["head"]
            if h[1] == "notConverged": s["rounds"] = 0''',
'''            if MODE == "adopt":
                if h[1] == "drift": s["expected"] = s["head"]
                if h[1] == "notConverged": s["rounds"] = 0''')
rep('("Exit", "rateLimited"), ("Exit", "failed"), ("CommitDone",),', '("Exit", "rateLimited"), ("Exit", "failed"), ("GitCommit",), ("CommitDone",),')
rep('("Reconcile", "accept"),', '("Reconcile", "accept"), ("Reconcile", "acceptHead"),')
# monitor
rep('crash_pending=False, fail_pending=False, corrections=0,', 'crash_pending=False, fail_pending=False, corrections=0, mexp=0, lbase=0,')
rep('        m["inflight"] = 1; m["waived"] = m["waived"] - {p}',
'''        if s_before["head"] != m["mexp"]: viol = "D launch on unrecorded HEAD"
        m["lbase"] = s_before["head"]
        m["inflight"] = 1; m["waived"] = m["waived"] - {p}''')
rep('''    if k == "CommitDone" and s_before["inflight"] and s_before["inflight"][1] == "succeeded":
        m["inflight"] = 0''', '''    if k == "CommitDone" and s_before["inflight"] and s_before["inflight"][1] == "gitcommitted":
        m["inflight"] = 0; m["mexp"] = s_before["head"]
    if k == "Reconcile" and m["crash_pending"]:
        if ev[1] == "discard": m["mexp"] = m["lbase"]
        elif ev[1] in ("accept", "acceptHead"): m["mexp"] = s_after["head"]
    if k == "Release" and ("failure", "drift") in s_before["holds"] and ("failure", "drift") not in s_after["holds"] and MODE == "adopt":
        m["mexp"] = s_after["head"]  # adopt semantics: user's release adopts HEAD''')
rep('    if s_after["rounds"] == 0 and s_before["rounds"] > MAXR: m["corrections"] = 0\n', '')
# liveness
rep('''    print(f"states explored: {n}; launch transitions: {launches}")''',
'''    print(f"states explored: {n}; launch transitions: {launches}")
    # liveness: reverse reachability to progress edges
    preds = {}; good = set(); first = {}
    for (k1, k2, prog) in edges:
        preds.setdefault(k2, []).append(k1)
        if prog: good.add(k1)
    work = list(good)
    while work:
        x = work.pop()
        for y in preds.get(x, []):
            if y not in good: good.add(y); work.append(y)
    def tr(i):
        out = []
        while par[i] is not None: i, e = par[i]; out.append(e)
        return tuple(reversed(out))
    dead = [i for i in range(len(par)) if i in expanded and i not in good]
    print(f"deadlocked states (no path to a launch or approval release): {len(dead)}")
    shown = {}
    for k in dead:
        s = sts[k]
        sig = (tuple(sorted(s["holds"])), s["step"], s["inflight"] and s["inflight"][1])
        if sig in shown: continue
        shown[sig] = 1
        print("DEADLOCK holds=%s step=%s inflight=%s head=%s expected=%s rounds=%s" % (sorted(s["holds"]), s["step"], s["inflight"], s["head"], s["expected"], s["rounds"]))
        print("   trace:", tr(k))
        if len(shown) >= 8: break''')
rep('''    dq = deque([(s0, m0, ())]); violations = {}; n = 0; launches = 0''',
'''    dq = deque([(s0, m0, ())]); violations = {}; n = 0; launches = 0
    expanded = set(); edges = []; ids = {(freeze(s0), freeze(m0)): 0}; par = [None]; sts = [s0]''')
rep('''            key = (freeze(s2), freeze(m2))
            if key not in seen:''', '''            key = (freeze(s2), freeze(m2))
            prog = "launch" in cmds or (ev[0] == "Approve" and s2["tranche"] != s["tranche"])
            if key not in ids:
                ids[key] = len(par); par.append((ids[(freeze(s), freeze(m))], ev)); sts.append(s2)
            edges.append((ids[(freeze(s), freeze(m))], ids[key], prog))
            if v: continue
            if key not in seen:''')
rep('''        if s["tranche"] >= 2: continue
        for ev in events(s):''', '''        if s["tranche"] >= 2: continue
        expanded.add(ids[(freeze(s), freeze(m))])
        for ev in events(s):''')
rep('s["inflight"] = None; s["rounds"] += 1', 's["inflight"] = None; s["rounds"] = min(s["rounds"] + 1, MAXR + 1)')
pathlib.Path(sys.argv[1]).write_text(src)
