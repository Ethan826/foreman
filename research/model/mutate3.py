"""Mutation test for check3.py (model check M3).

Each mutant changes the model part of check3.py only (decide, decide_run,
apply_run, unsettled and helpers), never the monitor or the search. A
mutant is KILLED if its run reports a safety violation or a liveness
deadlock, MISSED otherwise. Each mutant names the scope it is run in first;
a mutant missed there is run in the other scopes too. Runs are sequential:
python3 -I, timeout 280, --stop. Usage: python3 -I mutate3.py [ID...]

The M and N mutants are mutate2.py's 46, adapted to check3's code (M19,
"Crash keeps waiver", is now the faithful rule under fix 5, so it is
replaced by R5a, which restores the revision-2 text). R mutants are new,
keyed to the re-review fixes. Fix 9 is wording only and has no mutant.
R10a and R10b (amendment 8, revision 3.1) test approve --base.
"""
import sys, subprocess, pathlib

HERE = pathlib.Path(__file__).resolve().parent
SRC = (HERE / "check3.py").read_text()
REC, QUO, TRA = "recovery", "quota", "tranches"

M = {
 "M1 Run ignores holds (except at tranche end)": (REC, [('    if s["holds"]:\n        return ("refuse",)\n', '    if s["step"] == "done":\n        return ("refuse",)\n')]),
 "M2 Tick releases quota holds": (REC, [('    elif k == "Tick":\n        pass', '    elif k == "Tick":\n        s["holds"] = frozenset(h for h in s["holds"] if h[0] != "quota")')]),
 "M3 Approve ignores revision": (REC, [('        h = ("approval", t, r)\n        if h in s["holds"]:', '        hs = [x for x in s["holds"] if x[0] == "approval" and x[1] == t]\n        h = hs[0] if hs else None\n        if h:')]),
 "M3b Approve ignores tranche": (REC, [('        h = ("approval", t, r)\n        if h in s["holds"]:', '        hs = [x for x in s["holds"] if x[0] == "approval" and x[2] == r]\n        h = hs[0] if hs else None\n        if h:')]),
 "M4 startup creates no uncertain hold": (REC, [('                add_hold(s, out, ("uncertain", s["lastop"][0]), "startup")', '                pass')]),
 "M4b Crash clears the operation instead of orphaning it": (REC, [('            if s["inflight"]:\n                if s["inflight"][1] == "running" and not s["orphan"]: s["alive"] = True\n                s["orphan"] = True', '            s["inflight"] = None')]),
 "M5 no correction-round limit": (REC, [('                if s["rounds"] > MAXR: end_tranche(s, out, "notConverged")\n                else: s["step"] = "correct"', '                s["step"] = "correct"')]),
 "M6 Waive without quota hold": (REC, [('        p = ev[1]; h = qhold(s, p)\n        if h:', '        p = ev[1]; h = qhold(s, p)\n        if True:')]),
 "M7 discard does not reset HEAD": (REC, [('            s["head"] = target; s["dirty"] = ev[1] == "nested"', '            if kind != "discard": s["head"] = target; s["dirty"] = ev[1] == "nested"')]),
 "M8 Run skips drift check": (REC, [('    if s["head"] != s["expected"] or s["dirty"]:\n        return ("hold", ("drift",))\n', '')]),
 "M9 waiver not consumed by its launch": (REC, [('    s["waiver"] = None                       # any launch attempt uses or expires it\n', '    if d[0] != "launch": s["waiver"] = None\n')]),
 "M10 Observe(allow) never releases": (REC, [('            try_release_quota(s, out, p)\n    elif k == "Expire":', '            pass\n    elif k == "Expire":')]),
 "M11 Reconcile is a no-op": (REC, [('        if ("uncertain", o) in s["holds"] and s["req"] is None and s["inflight"]:', '        if False:')]),
 "M12 revision-1 notConverged: failure hold, Release resets rounds": (REC, [
     ('                if s["rounds"] > MAXR: end_tranche(s, out, "notConverged")', '                if s["rounds"] > MAXR: add_hold(s, out, ("failure",), "notConverged")'),
     ('            s["holds"] -= {("failure",)}; out.append(("release", ("failure",)))', '            s["holds"] -= {("failure",)}; out.append(("release", ("failure",)))\n            if s["rounds"] > MAXR: s["rounds"] = 0; s["step"] = "correct"')]),
 "M13 Approve keeps rounds": (TRA, [('            s["step"] = "impl"; s["rounds"] = 0; s["allowp"] = a', '            s["step"] = "impl"; s["allowp"] = a')]),
 "M14 CommitDone leaves expected": (REC, [('        s["inflight"] = None; settle(s, "C"); s["expected"] = r; s["step"] = "review"', '        s["inflight"] = None; settle(s, "C"); s["step"] = "review"')]),
 "M15 Release releases every hold": (REC, [('            s["holds"] -= {("failure",)}; out.append(("release", ("failure",)))', '            s["holds"] = frozenset(); out.append(("release", ("failure",)))')]),
 "M16 accept allowed on a review": (REC, [('            if res == "accept" and step in MUTATING:', '            if res == "accept":')]),
 "M17 abandon: no approval hold": (REC, [('            if kind == "abandon": end_tranche(s, out, "abandoned")', '            if kind == "abandon": s["step"] = "impl"; s["tranche"] += 1')]),
 "M18 Expire ignored": (REC, [('        p, w = ev[1:]; v, post = getd(s, "q", (p, w)); setd(s, "q", (p, w), ("no", post))', '        pass')]),
 "M20 rateLimited (mutating) no hold": (REC, [('                new_quota(s, out, p, need, "rateLimited")', '                pass')]),
 "M21 commit ignores a moved HEAD": (REC, [('        elif s["head"] != base:\n            s["inflight"] = None; settle(s, "C"); out.append(("commitRefused", o, "headMoved"))', '        elif False:\n            s["inflight"] = None; settle(s, "C"); out.append(("commitRefused", o, "headMoved"))')]),
 "N1 pre-hold observation releases quota hold (R-S1)": (REC, [('            post = age == "post" and qhold(s, p) is not None', '            post = qhold(s, p) is not None')]),
 "N2 drift check ignores dirty tree (R-S2)": (REC, [('    if s["head"] != s["expected"] or s["dirty"]:', '    if s["head"] != s["expected"]:')]),
 "N3 adopt allowed on dirty tree": (REC, [('            if not s["dirty"]:\n                s["holds"] -= {("drift",)}; s["expected"] = s["head"]', '            if True:\n                s["holds"] -= {("drift",)}; s["expected"] = s["head"]')]),
 "N4 adopt does not record HEAD": (REC, [('                s["holds"] -= {("drift",)}; s["expected"] = s["head"]', '                s["holds"] -= {("drift",)}')]),
 "N5 restore does not reset the tree": (REC, [('            s["head"] = target; s["dirty"] = ev[1] == "nested"', '            if kind != "restore": s["head"] = target; s["dirty"] = ev[1] == "nested"')]),
 "N6 notConverged one round early": (REC, [('                if s["rounds"] > MAXR: end_tranche', '                if s["rounds"] >= MAXR: end_tranche')]),
 "N7 protected change committed without permission": (REC, [('        if s["pt"]:\n            s["inflight"] = None; settle(s, "C"); out.append(("commitRefused", o, "protectedPath"))\n            add_hold(s, out, ("protected",), "commit")', '        if False:\n            pass'),
     ('                if s["pt"]:\n                    s["inflight"] = None; settle(s, "C"); out.append(("commitRefused", o, "protectedPath"))\n                else:\n                    s["inflight"] = (step, "exited", base, None, o)', '                s["inflight"] = (step, "exited", base, None, o)')]),
 "N8 protected permission persists across tranches": (TRA, [('            s["step"] = "impl"; s["rounds"] = 0; s["allowp"] = a', '            s["step"] = "impl"; s["rounds"] = 0; s["allowp"] = s["allowp"] or a')]),
 "N9 nothing-to-commit treated as a commit": (REC, [('                    settle(s, "C"); s["step"] = "review"; out.append(("nothing", o))', '                    s["inflight"] = (step, "exited", base, None, o)')]),
 "N10 startup ignores an exited or committed operation": (REC, [('    return "S" in facts and mut and "C" not in facts', '    return False')]),
 "N11 append without log-position check (R-S3)": (TRA, [('        setd(s, "pend", "A", (False, None))', '        setd(s, "pend", "A", (False, decide_run(s)))'), ('        if s["lock"] == "A" and not pd[0]:\n            apply_run(s, decide_run(s), out)', '        if s["lock"] == "A":\n            apply_run(s, pd[1] if pd[0] else decide_run(s), out)')]),
 "N12 RunB ignores the lock (R-S3)": (REC, [('    elif k in ("RunA", "RunB"):\n        if s["lock"] == k[-1]:', '    elif k in ("RunA", "RunB"):\n        if s["lock"] == k[-1] or k == "RunB":')]),
 "N13 Start ignores the lock (R-S3)": (REC, [('        if s["lock"] is None:\n            s["lock"] = i;', '        if True:\n            s["lock"] = i;')]),
 "N14 waiver survives a refused attempt (R-S4)": (REC, [('    s["waiver"] = None                       # any launch attempt uses or expires it\n', '    if d[0] == "launch": s["waiver"] = None\n')]),
 "N15 waiver used by another provider's step": (REC, [('    if s["waiver"] == p:', '    if s["waiver"] is not None:')]),
 "N16 Waive leaves the hold": (REC, [('            s["holds"] -= {h}; s["waiver"] = p', '            s["waiver"] = p')]),
 "N17 abandon does not restore the tree": (REC, [('            s["head"] = target; s["dirty"] = ev[1] == "nested"', '            if kind != "abandon": s["head"] = target; s["dirty"] = ev[1] == "nested"')]),
 "N18 approval hold names HEAD, not the recorded revision": (REC, [('    h = ("approval", s["tranche"], s["expected"])', '    h = ("approval", s["tranche"], s["head"])')]),
 "N19 Release of a failure also clears drift": (REC, [('            s["holds"] -= {("failure",)}; out.append(("release", ("failure",)))', '            s["holds"] -= {("failure",), ("drift",)}; out.append(("release", ("failure",)))')]),
 "N20 accept records the base, not HEAD": (REC, [('                s["expected"] = s["head"]; s["step"] = "review"', '                s["expected"] = base; s["step"] = "review"')]),
 "N21 restore leaves the drift hold": (REC, [('                s["holds"] -= {("drift",)}; out.append(("release", ("drift",))); out.append(("restored", target))', '                out.append(("release", ("drift",))); out.append(("restored", target))')]),
 "N22 failed mutating step leaves no failure hold": (REC, [('                s["dirty"] = True; s["inflight"] = None\n                add_hold(s, out, ("failure",), "failed")', '                s["dirty"] = True; s["inflight"] = None')]),
 "N23 commit failure leaves no hold": (REC, [('        add_hold(s, out, ("failure",), "commitFailed")', '        pass')]),
 # ---- fix 1: protected-change detection ----
 "R1a git status before the digest compare at launch": (REC, [('    if s["pt"]:\n        return ("hold", ("protected",))\n    if s["head"] != s["expected"] or s["dirty"]:\n        return ("hold", ("drift",))\n', '    if s["head"] != s["expected"] or s["dirty"]:\n        return ("hold", ("drift",))\n    if s["pt"]:\n        return ("hold", ("protected",))\n')]),
 "R1b no compare after a mutating step (E1)": (REC, [('                add_hold(s, out, ("failure",), "failed")\n            if s["pt"]: add_hold(s, out, ("protected",), "exit")\n        else:', '                add_hold(s, out, ("failure",), "failed")\n        else:')]),
 "R1c no compare at startup": (REC, [('            if s["pt"]: add_hold(s, out, ("protected",), "startup")', '            pass')]),
 "R1d no compare before the commit": (REC, [('        if s["pt"]:\n            s["inflight"] = None; settle(s, "C"); out.append(("commitRefused", o, "protectedPath"))\n            add_hold(s, out, ("protected",), "commit")', '        if False:\n            pass')]),
 "R1e no compare before a requested reset": (REC, [('        if s["pt"]:\n            add_hold(s, out, ("protected",), "perform")', '        if False:\n            pass')]),
 "R1f adopt runs git status without a compare": (REC, [('        if ("drift",) in s["holds"] and s["req"] is None and not s["pt"]:', '        if ("drift",) in s["holds"] and s["req"] is None:')]),
 "R1g release-protected without re-digest": (REC, [('        if ("protected",) in s["holds"] and (ev[1] or not s["pt"]):\n            s["pt"] = False;', '        if ("protected",) in s["holds"]:\n            s["pt"] = s["pt"] and not ev[1];')]),
 "R1h permitted change not recorded as baseline": (TRA, [('        if s["allowp"] and s["pt"]:      # step 4: a permitted change becomes the baseline\n            s["pt"] = False; out.append(("baseline", o))\n', '')]),
 # ---- fix 2: reconciled is settled; reconcile names the held opId ----
 "R2a startup holds a reconciled operation (T2)": (REC, [('    if "R" in facts: return False\n', '')]),
 "R2b reconcile accepts any opId": (REC, [('        if ("uncertain", o) in s["holds"] and s["req"] is None and s["inflight"]:', '        if any(h[0] == "uncertain" for h in s["holds"]) and s["req"] is None and s["inflight"]:\n            o = s["inflight"][4]')]),
 # ---- fix 3: intent-first CLI git effects ----
 "R3a restore runs git at the CLI (effect then append)": (REC, [('            s["req"] = ("restore", s["expected"], s["head"], False)\n            out.append(("requested", "restore", None, s["expected"], s["head"]))', '            s["head"] = s["expected"]; s["dirty"] = False; s["holds"] -= {("drift",)}\n            out.append(("git", "reset")); out.append(("reset", s["expected"])); out.append(("release", ("drift",)))')]),
 "R3b requested reset without the HEAD guard": (REC, [('        elif s["head"] not in (at, target):', '        elif False:')]),
 "R3c pending request does not block a launch": (REC, [('    if (s["inflight"] and not s["orphan"]) or s["req"]:', '    if (s["inflight"] and not s["orphan"]):')]),
 "R3d crash drops the pending request": (REC, [('            setd(s, "pend", s["lock"], None); s["lock"] = None', '            setd(s, "pend", s["lock"], None); s["lock"] = None; s["req"] = None')]),
 # ---- fix 4: process group ----
 "R4a startup signals but does not kill the group": (REC, [('                s["alive"] = False; out.append(("killpg", s["lastop"][0]))', '                out.append(("killpg", s["lastop"][0]))')]),
 "R4b startup does not kill at all": (REC, [('                s["alive"] = False; out.append(("killpg", s["lastop"][0]))', '                pass')]),
 # ---- fix 5: waiver lifetime ----
 "R5a restart expires the waiver (revision-2 text, T1)": (REC, [('            s["lock"] = i; out.append(("started", i))', '            s["lock"] = i; out.append(("started", i)); s["waiver"] = None')]),
 # ---- fix 6: holds ----
 "R6a refused attempt also holds for drift (two holds per attempt)": (REC, [('    if d[0] == "refuse":\n        out.append(("refused",)); return', '    if d[0] == "refuse":\n        out.append(("refused",))\n        if s["dirty"]: add_hold(s, out, ("drift",), "run")\n        return')]),
 # ---- fix 7: incomplete restore ----
 "R7a restore left dirty releases the drift hold": (REC, [('            if s["dirty"]:\n                out.append(("restoreIncomplete",))', '            if False:\n                out.append(("restoreIncomplete",))')]),
 # ---- fix 8: quota release per named window; observation order ----
 "R8a quota released by any window's post-hold allow": (QUO, [('    if h and all(getd(s, "q", (p, w)) == ("allow", True) for w in h[2]):', '    if h and any(getd(s, "q", (p, w)) == ("allow", True) for w in WINS[p]):')]),
 "R8b last-ingested reading wins (older readings applied)": (QUO, [('        if age != "old":\n            post = age == "post"', '        if True:\n            post = age == "post"')]),
 "R8c reset of one window releases the whole hold": (QUO, [('            s["holds"] -= {h}; rest = h[2] - {w}', '            s["holds"] -= {h}; rest = frozenset()')]),
 "R8d unnamed rate limit holds only window a": (QUO, [('                need = WINS[p] if kind == "rl_u" else (kind[-1],)', '                need = ("a",) if kind == "rl_u" else (kind[-1],)')]),
 "R10a base completion keeps the old revision": (REC, [('            s["expected"] = target; out.append(("rebased", target))', '            out.append(("rebased", target))')]),
 "R10b approve --base resets at the CLI (no request)": (REC, [('                s["rev"] = ev[4]; s["req"] = ("base", ev[4], s["head"], False)\n                out.append(("requested", "base", None, ev[4], s["head"]))', '                s["rev"] = ev[4]; s["head"] = ev[4]; s["expected"] = ev[4]\n                out.append(("git", "reset")); out.append(("reset", ev[4]))')]),
}

only = sys.argv[1:]


def run(mid, scope, text):
    f = HERE / ("mut3_" + mid + ".py"); f.write_text(text)
    r = subprocess.run(["timeout", "280", "python3", "-I", str(f), scope, "--stop"], capture_output=True, text=True)
    f.unlink()
    lines = r.stdout.splitlines()
    found = [l for l in lines if l.startswith("FOUND")]
    live = [l for l in lines if l.startswith("liveness:")]
    states = [l for l in lines if l.startswith("scope ")]
    cnt = [l for l in lines if l.startswith("counters:")]
    dead = live and not live[0].endswith(": 0")
    verdict = "KILLED" if (found or dead) else ("TIMEOUT" if r.returncode == 124 else
               ("ERROR " + (r.stderr.strip().splitlines() or ["?"])[-1] if r.returncode != 0 else "MISSED"))
    return verdict, found[:1], live, states, cnt


for name, (scope, reps) in M.items():
    mid = name.split()[0]
    if only and mid not in only: continue
    t = SRC
    for a, b in reps:
        assert t.count(a) == 1, (name, t.count(a), a)
        t = t.replace(a, b)
    verdict, found, live, states, cnt = run(mid, scope, t)
    print(f"{name} [{scope}]: {verdict} {found} {live} {states} {cnt}", flush=True)
    if verdict != "KILLED":
        for other in (REC, QUO, TRA):
            if other == scope: continue
            v2, f2, l2, s2, c2 = run(mid, other, t)
            print(f"    also [{other}]: {v2} {f2} {l2} {s2} {c2}", flush=True)
            if v2 == "KILLED": break
