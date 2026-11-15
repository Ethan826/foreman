"""Mutation test for check2.py (model check M2).

Each mutant changes the model part of check2.py only (decide / decide_run /
apply_run / end_tranche), never the monitor or the search. A mutant is
KILLED if the run reports a safety violation or a liveness deadlock;
MISSED otherwise. Runs one at a time: python3 -I, timeout 250, with
--stop (stop at the first violation). Usage: python3 -I mutate2.py [ID...]
"""
import sys, subprocess, pathlib

HERE = pathlib.Path(__file__).resolve().parent
SRC = (HERE / "check2.py").read_text()

M = {
 # ---- the reviewer's M1-M21, adapted to revision 2 ----
 "M1 Run ignores holds (except at tranche end, where the step has no provider)": [('    if s["holds"]:\n        return ("refuse",)\n', '    if s["step"] == "done":\n        return ("refuse",)\n')],
 "M2 Tick releases quota holds": [('    elif k == "Tick":\n        pass', '    elif k == "Tick":\n        s["holds"] = frozenset(h for h in s["holds"] if h[0] != "quota")')],
 "M3 Approve ignores revision": [('        h = ("approval", t, r)\n        if h in s["holds"]:', '        hs = [x for x in s["holds"] if x[0] == "approval" and x[1] == t]\n        h = hs[0] if hs else None\n        if h:')],
 "M3b Approve ignores tranche": [('        h = ("approval", t, r)\n        if h in s["holds"]:', '        hs = [x for x in s["holds"] if x[0] == "approval" and x[2] == r]\n        h = hs[0] if hs else None\n        if h:')],
 "M4 startup creates no uncertain hold": [('                s["holds"] |= {("uncertain",)}; out.append(("hold", ("uncertain",), "startup"))', '                pass')],
 "M4b Crash clears the operation instead of orphaning it": [('            if s["inflight"]: s["orphan"] = True', '            s["inflight"] = None')],
 "M5 no correction-round limit": [('                if s["rounds"] > MAXR: end_tranche(s, out, "notConverged")\n                else: s["step"] = "correct"', '                s["step"] = "correct"')],
 "M6 Waive without quota hold": [('        if ("quota", p) in s["holds"]:\n            s["holds"] -= {("quota", p)}; s["waiver"] = p', '        if True:\n            s["holds"] -= {("quota", p)}; s["waiver"] = p')],
 "M7 discard does not reset HEAD": [('            if res == "discard":\n                s["holds"] -= {("uncertain",)}; s["inflight"] = None\n                s["head"] = base; s["expected"] = base; s["dirty"] = False', '            if res == "discard":\n                s["holds"] -= {("uncertain",)}; s["inflight"] = None\n                s["expected"] = base')],
 "M8 Run skips drift check": [('    if s["head"] != s["expected"] or s["dirty"]:\n        return ("hold", ("drift",))\n', '')],
 "M9 waiver not consumed by its launch": [('    s["waiver"] = None                      # any launch attempt consumes or expires it\n    if d[0] == "refuse":\n        out.append(("refused",)); return\n    if d[0] == "hold":\n        s["holds"] |= {d[1]};', '    if d[0] == "refuse":\n        s["waiver"] = None; out.append(("refused",)); return\n    if d[0] == "hold":\n        s["waiver"] = None; s["holds"] |= {d[1]};')],
 "M10 Observe(allow) never releases": [('            s["holds"] -= {("quota", p)}; out.append(("release", ("quota", p)))\n    elif k == "Expire":', '            pass\n    elif k == "Expire":')],
 "M11 Reconcile is a no-op": [('        if ("uncertain",) in s["holds"] and s["inflight"]:', '        if False:')],
 "M12 revision-1 notConverged: failure hold, Release resets rounds": [
     ('                if s["rounds"] > MAXR: end_tranche(s, out, "notConverged")', '                if s["rounds"] > MAXR: s["holds"] |= {("failure",)}; out.append(("hold", ("failure",), "notConverged"))'),
     ('            s["holds"] -= {("failure",)}; out.append(("release", ("failure",)))', '            s["holds"] -= {("failure",)}; out.append(("release", ("failure",)))\n            if s["rounds"] > MAXR: s["rounds"] = 0; s["step"] = "correct"')],
 "M13 Approve keeps rounds": [('            s["step"] = "impl"; s["rounds"] = 0; s["allowp"] = a', '            s["step"] = "impl"; s["allowp"] = a')],
 "M14 CommitDone leaves expected": [('        s["inflight"] = None; s["expected"] = r; s["step"] = "review"', '        s["inflight"] = None; s["step"] = "review"')],
 "M15 Release releases every hold": [('            s["holds"] -= {("failure",)}; out.append(("release", ("failure",)))', '            s["holds"] = frozenset(); out.append(("release", ("failure",)))')],
 "M16 accept allowed on a review": [('            elif res == "accept" and step in MUTATING:', '            elif res == "accept":')],
 "M17 abandon: no approval hold": [('                end_tranche(s, out, "abandoned")', '                s["step"] = "impl"; s["tranche"] += 1')],
 "M18 Expire ignored": [('        setq(s, ev[1], "no")\n    elif k == "Tick":', '        pass\n    elif k == "Tick":')],
 "M19 Crash keeps waiver": [('            setpend(s, s["lock"], None); s["lock"] = None\n            s["waiver"] = None', '            setpend(s, s["lock"], None); s["lock"] = None')],
 "M20 rateLimited (mutating) no hold": [('                s["dirty"] = True; s["inflight"] = None; setq(s, p, "no")\n                s["holds"] |= {("quota", p)}; out.append(("hold", ("quota", p), "rateLimited"))', '                s["dirty"] = True; s["inflight"] = None; setq(s, p, "no")')],
 "M21 commit ignores a moved HEAD": [('        if s["head"] != base:\n            s["inflight"] = None', '        if False:\n            s["inflight"] = None')],
 # ---- new rules in revision 2 ----
 "N1 stale observation releases quota hold (R-S1)": [('        if v == "allow" and fresh and ("quota", p) in s["holds"]:', '        if v == "allow" and ("quota", p) in s["holds"]:')],
 "N2 drift check ignores dirty tree (R-S2)": [('    if s["head"] != s["expected"] or s["dirty"]:', '    if s["head"] != s["expected"]:')],
 "N3 adopt allowed on dirty tree": [('        if ("drift",) in s["holds"] and not s["dirty"]:', '        if ("drift",) in s["holds"]:')],
 "N4 adopt does not record HEAD": [('            s["holds"] -= {("drift",)}; s["expected"] = s["head"]', '            s["holds"] -= {("drift",)}')],
 "N5 restore does not reset the tree": [('            s["holds"] -= {("drift",)}; s["head"] = s["expected"]; s["dirty"] = False', '            s["holds"] -= {("drift",)}')],
 "N6 notConverged one round early": [('                if s["rounds"] > MAXR: end_tranche', '                if s["rounds"] >= MAXR: end_tranche')],
 "N7 protected change committed without permission": [('            if kind == "changed" or (kind == "protected" and s["allowp"]):', '            if kind in ("changed", "protected"):')],
 "N8 protected permission persists across tranches": [('            s["step"] = "impl"; s["rounds"] = 0; s["allowp"] = a', '            s["step"] = "impl"; s["rounds"] = 0; s["allowp"] = s["allowp"] or a')],
 "N9 nothing-to-commit treated as a commit": [('                s["inflight"] = None; s["step"] = "review"; out.append(("nothing",))', '                s["inflight"] = (step, "exited", base, None)')],
 "N10 startup ignores an exited or committed operation": [('            if s["inflight"]: s["orphan"] = True', '            if s["inflight"] and s["inflight"][1] == "running": s["orphan"] = True')],
 "N11 append without log-position check (R-S3)": [('        setpend(s, i, (False, None))   # the read decision is recomputed at append (mutant N11 stores it)', '        setpend(s, i, (False, decide_run(s)))'), ('        if s["lock"] == i and not pd[0]:\n            apply_run(s, decide_run(s), out)', '        if s["lock"] == i:\n            apply_run(s, pd[1] if pd[0] else decide_run(s), out)')],
 "N12 RunB ignores the lock (R-S3)": [('        if s["lock"] == "B":', '        if True:')],
 "N13 Start ignores the lock (R-S3)": [('        if s["lock"] is None:\n            s["lock"] = i;', '        if True:\n            s["lock"] = i;')],
 "N14 waiver survives a refused attempt (R-S4)": [('    s["waiver"] = None                      # any launch attempt consumes or expires it\n    if d[0] == "refuse":\n        out.append(("refused",)); return\n    if d[0] == "hold":\n        s["holds"] |= {d[1]};', '    if d[0] == "refuse":\n        out.append(("refused",)); return\n    if d[0] == "hold":\n        s["holds"] |= {d[1]};')],
 "N15 waiver used by another provider's step": [('    if s["waiver"] == p:\n        return ("launch"', '    if s["waiver"] is not None:\n        return ("launch"')],
 "N16 Waive leaves the hold": [('            s["holds"] -= {("quota", p)}; s["waiver"] = p', '            s["waiver"] = p')],
 "N17 abandon does not restore the tree": [('            elif res == "abandon":\n                s["holds"] -= {("uncertain",)}; s["inflight"] = None\n                s["head"] = base; s["expected"] = base; s["dirty"] = False', '            elif res == "abandon":\n                s["holds"] -= {("uncertain",)}; s["inflight"] = None\n                s["expected"] = base')],
 "N18 approval hold names HEAD, not the recorded revision": [('    h = ("approval", s["tranche"], s["expected"])', '    h = ("approval", s["tranche"], s["head"])')],
 "N19 Release of a failure also clears drift": [('            s["holds"] -= {("failure",)}; out.append(("release", ("failure",)))', '            s["holds"] -= {("failure",), ("drift",)}; out.append(("release", ("failure",)))')],
 "N20 accept records the base, not HEAD": [('                s["expected"] = s["head"]; s["step"] = "review"', '                s["expected"] = base; s["step"] = "review"')],
 "N21 restore leaves the drift hold": [('            s["holds"] -= {("drift",)}; s["head"] = s["expected"]; s["dirty"] = False', '            s["head"] = s["expected"]; s["dirty"] = False')],
 "N22 failed mutating step leaves no failure hold": [('                s["dirty"] = True; s["inflight"] = None\n                s["holds"] |= {("failure",)}; out.append(("hold", ("failure",), "failed"))', '                s["dirty"] = True; s["inflight"] = None')],
 "N23 commit failure leaves no hold": [('        s["holds"] |= {("failure",)}; out.append(("hold", ("failure",), "commitFailed"))', '        pass')],
}

only = sys.argv[1:]
for name, reps in M.items():
    mid = name.split()[0]
    if only and mid not in only: continue
    t = SRC
    for a, b in reps:
        assert t.count(a) == 1, (name, t.count(a), a)
        t = t.replace(a, b)
    f = HERE / ("mut2_" + mid + ".py"); f.write_text(t)
    r = subprocess.run(["timeout", "250", "python3", "-I", str(f), "--stop"], capture_output=True, text=True)
    f.unlink()
    lines = r.stdout.splitlines()
    found = [l for l in lines if l.startswith("FOUND")]
    live = [l for l in lines if l.startswith("liveness:")]
    states = [l for l in lines if l.startswith("states explored")]
    dead = live and not live[0].endswith(": 0")
    verdict = "KILLED" if (found or dead) else ("TIMEOUT" if r.returncode == 124 else
               ("ERROR " + r.stderr.strip().splitlines()[-1] if r.returncode not in (0, 124) else "MISSED"))
    print(f"{name}: {verdict} rc={r.returncode} {found[:1]} {live} {states}", flush=True)
