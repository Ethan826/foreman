import sys, subprocess, pathlib
src = pathlib.Path("orig.py").read_text()
# harness change (mutants only): do not expand past a violating transition
A = '                violations[v] = trace + (ev,); print("FOUND", v, len(trace)+1, flush=True)\n'
assert src.count(A) == 1
src = src.replace(A, A + "            if v: continue\n")
M = {
 "M1 Run ignores holds": [('if s["holds"] or s["inflight"] or s["step"] == "done":', 'if s["inflight"] or s["step"] == "done":')],
 "M1b Run ignores holds and done": [('if s["holds"] or s["inflight"] or s["step"] == "done":', 'if s["inflight"]:')],
 "M2 Tick releases quota holds": [('    elif k == "Tick":\n        pass', '    elif k == "Tick":\n        s["holds"] = frozenset(h for h in s["holds"] if h[0] != "quota")')],
 "M3 Approve ignores revision": [('h = ("approval", t, r)\n        if h in s["holds"]:', 'hs = [x for x in s["holds"] if x[0]=="approval" and x[1]==t]\n        h = hs[0] if hs else None\n        if h:')],
 "M3b Approve ignores tranche": [('h = ("approval", t, r)\n        if h in s["holds"]:', 'hs = [x for x in s["holds"] if x[0]=="approval" and x[2]==r]\n        h = hs[0] if hs else None\n        if h:')],
 "M4 Crash creates no uncertain hold": [('            s["holds"] |= {("uncertain",)}\n', '')],
 "M4b Crash: no hold, clears inflight": [('            s["holds"] |= {("uncertain",)}\n            s["inflight"] = (s["inflight"][0], "unknown", s["inflight"][2])', '            s["inflight"] = None')],
 "M5 no correction-round limit": [('if s["rounds"] > MAXR: s["holds"] |= {("failure", "notConverged")}\n            else: s["step"] = "correct"', 's["step"] = "correct"')],
 "M6 Waive without quota hold": [('        if ("quota", p) in s["holds"]:\n            s["holds"] -= {("quota", p)}; s["waiver"] |= {p}', '        s["holds"] -= {("quota", p)}; s["waiver"] |= {p}')],
 "M7 discard does not reset HEAD": [('                s["head"] = base; s["expected"] = base', '                pass')],
 "M8 Run skips drift check": [('        if s["head"] != s["expected"]:\n            s["holds"] |= {("failure", "drift")}; return s, cmds', '')],
 "M9 waiver not consumed": [('        s["waiver"] = s["waiver"] - {p}\n        cmds', '        cmds')],
 "M10 Observe(allow) never releases": [('        if v == "allow": s["holds"] -= {("quota", p)}', '        pass')],
 "M11 Reconcile is a no-op": [('        if ("uncertain",) in s["holds"] and s["inflight"]:', '        if False:')],
 "M12 Release does not reset rounds": [('            if h[1] == "notConverged": s["rounds"] = 0', '            pass')],
 "M13 Approve keeps rounds": [('            s["step"] = "impl"; s["rounds"] = 0', '            s["step"] = "impl"')],
 "M14 CommitDone leaves expected": [('r = nextrev(s); s["head"] = r; s["expected"] = r\n            advance_after_success(s, step)', 'r = nextrev(s); s["head"] = r\n            advance_after_success(s, step)')],
 "M15 Release releases every hold": [('h = sorted(fs)[0]; s["holds"] -= {h}', 'h = sorted(fs)[0]; s["holds"] = frozenset()')],
 "M16 Reconcile accept skips approval on review": [('                r = nextrev(s); s["head"] = r; s["expected"] = r\n                advance_after_success(s, step)', '                r = nextrev(s); s["head"] = r; s["expected"] = r\n                s["step"] = "impl" if step=="review" else "review"')],
 "M17 abandon: no approval hold": [('                s["step"] = "done"\n                s["holds"] |= {("approval", s["tranche"], s["expected"])}', '                s["step"] = "impl"; s["tranche"] += 1')],
 "M18 Expire ignored": [('        if q(s, ev[1]) == "allow": setq(s, ev[1], "unknown")', '        pass')],
 "M19 Crash keeps waiver": [('        s["waiver"] = frozenset()\n    elif k == "Tick"', '    elif k == "Tick"')],
 "M20 rateLimited no hold": [('setq(s, p, "hold")\n            s["holds"] |= {("quota", p)}', 'setq(s, p, "hold")')],
 "M21 Drift allowed in flight": [('        if not s["inflight"]:\n            r = nextrev(s); s["head"] = r', '        r = nextrev(s); s["head"] = r')],
}
only = sys.argv[1:] 
for name, reps in M.items():
    if only and not any(name.startswith(o+" ") for o in only): continue
    t = src
    for a, b in reps:
        assert t.count(a) == 1, (name, a)
        t = t.replace(a, b)
    f = pathlib.Path("mut_" + name.split()[0] + ".py"); f.write_text(t)
    r = subprocess.run(["timeout", "250", "python3", "-I", str(f)], capture_output=True, text=True)
    out = r.stdout
    found = [l for l in out.splitlines() if l.startswith("FOUND")]
    summ = [l for l in out.splitlines() if l.startswith("states")]
    print(f"{name}: rc={r.returncode} {summ} {found or 'MISSED'}", flush=True)
