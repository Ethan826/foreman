"""Mutation test for check4.py (model check M4).

Each mutant changes the model part of check4.py only (decide and its
helpers), never the monitor or the search. A mutant is KILLED if its run
reports a safety violation or a liveness deadlock, MISSED otherwise. Each
mutant names the scope it is run in first; a mutant missed there is run in
the other scopes too, in the order ledger, stages, queue1 (queue1 from
check4 amendment 5). Runs are sequential: python3 -I, timeout 280, --stop.
Usage: python3 -I mutate4.py [ID...]
"""
import sys, subprocess, pathlib

HERE = pathlib.Path(__file__).resolve().parent
SRC = (HERE / "check4.py").read_text()
LED, STA, Q1 = "ledger", "stages", "queue1"   # Q1: amendment 5 of check4.py

M = {
 # reserve and periods
 "RS1 the reserve is borrowable (cap is U)": (LED, [('def cap(s, pi): return SD if s["ovr"][pi] is not None else U - RESERVE', 'def cap(s, pi): return SD if s["ovr"][pi] is not None else U')]),
 "RS2 readings stay usable after the reset time passes": (LED, [('def rule1(s, pi): return (not s["passed"][pi]) and used(s, pi) + EST <= cap(s, pi)', 'def rule1(s, pi): return used(s, pi) + EST <= cap(s, pi)')]),
 "PD1 the timer opens a period (use starts over)": (LED, [('        s["passed"] = tset(s["passed"], pi, True); s["ovr"] = tset(s["ovr"], pi, None)', '        s["passed"] = tset(s["passed"], pi, True); s["ovr"] = tset(s["ovr"], pi, None)\n        for j in PROJ: s["spend"] = tset(s["spend"], j * 2 + pi, 0)')]),
 "PD2 an old-period grant's overshoot is charged to the new period": (LED, [('        if per == s["per"][pi]:\n            s["spend"]', '        if True:\n            s["spend"]')]),
 # allocations
 "AL1 the ceiling is ignored": (LED, [('    return (s["spend"][j * 2 + pi] + EST <= CEIL[j]\n', '    return (s["spend"][j * 2 + pi] + EST <= U\n')]),
 "AL2 no borrowing (allocation used as the ceiling)": (LED, [('    return (s["spend"][j * 2 + pi] + EST <= CEIL[j]\n', '    return (s["spend"][j * 2 + pi] + EST <= ALLOC[j]\n')]),
 "AL3 borrowing beyond the sum of allocations": (LED, [('            and sum(s["spend"][k * 2 + pi] for k in PROJ) + EST <= sum(ALLOC))\n\n\ndef started', '            and True)\n\n\ndef started')]),
 "AL4 allocations enforced in fallback": (LED, [('    if not s["conv"][pi] or s["ovr"][pi] is not None:\n        return True', '    if s["ovr"][pi] is not None:\n        return True')]),
 "AL5 allocations ignored in ledger mode": (LED, [('    if not s["conv"][pi] or s["ovr"][pi] is not None:\n        return True', '    if True:\n        return True')]),
 # spend-down
 "SD1 spend-down survives a new period": (LED, [('        s["ovr"] = tset(s["ovr"], pi, None)\n        s["first"]', '        s["first"]')]),
 "SD2 spend-down survives the reset time": (LED, [('        s["passed"] = tset(s["passed"], pi, True); s["ovr"] = tset(s["ovr"], pi, None)', '        s["passed"] = tset(s["passed"], pi, True)')]),
 "SD3 spend-down accepted after the reset time": (LED, [('        if not s["passed"][pi] and s["ovr"][pi] is None:', '        if s["ovr"][pi] is None:')]),
 "SD4 spend-down keeps allocations in force": (LED, [('    if not s["conv"][pi] or s["ovr"][pi] is not None:\n        return True', '    if not s["conv"][pi]:\n        return True')]),
 # review queue
 "QB1 the bound is off by one": (Q1, [('len(q) + 1 <= BOUND:\n        c.append(("impl", nxt))', 'len(q) <= BOUND:\n        c.append(("impl", nxt))')]),
 "UW1 no unwind on a change request": (STA, [('                if stacked:\n                    s["tip"]', '                if False:\n                    s["tip"]')]),
 "UW2 unwind does not re-arm the pre-approval": (STA, [('                    s["pre"] = tset(s["pre"], j, s["pre"][j] | frozenset(stacked))\n', '')]),
 # backlog and approvals
 "BK1 a pre-approval is not used by its launch": (Q1, [('                    s["pre"] = tset(s["pre"], j, s["pre"][j] - {cd[1]})\n', '')]),
 "BK2 a passing review never holds when anything is pre-approved": (Q1, [('if not (nxt <= T and (nxt in s["pre"][j] or nxt in s["live"][j] or started(s, j, nxt))):', 'if not (s["pre"][j] or (nxt <= T and (nxt in s["live"][j] or started(s, j, nxt)))):')]),
 "BK3 notConverged skips the hold when the next tranche is pre-approved": (STA, [('                if r > MAXR[j]:\n', '                if r > MAXR[j] and (h + 1) not in s["pre"][j]:\n')]),
 "BK4 pre-approval accepted for a started tranche": (STA, [('        if not started(s, j, t) and t not in s["pre"][j]', '        if t not in s["pre"][j]')]),
 "BK5 approve ignores the tranche": (STA, [('        if s["ahold"][j] == t:', '        if s["ahold"][j] is not None:')]),
 "BK6 a pre-approval releases the approval hold": (STA, [('            s["pre"] = tset(s["pre"], j, s["pre"][j] | {t})\n            return s, [("preapproved", j, t)]', '            s["pre"] = tset(s["pre"], j, s["pre"][j] | {t})\n            if s["ahold"][j] == t - 1: s["ahold"] = tset(s["ahold"], j, None)\n            return s, [("preapproved", j, t)]')]),
 # roles
 "SW1 a suggestion swaps the roles": (STA, [('                out.append(("suggest", j))', '                out.append(("suggest", j)); s["roles"] = tset(s["roles"], j, "swap" if s["roles"][j] == "std" else "std")')]),
 "SW2 the reviewer gets the editing profile": (STA, [('"ro" if cd[0] == "review" else "edit"))', '"edit"))')]),
 "SW3 the corrector keeps the old implementer's client": (STA, [('    edit = "c" if roles == "std" else "x"\n    return edit if step != "review"', '    edit = "c" if roles == "std" else "x"\n    if step == "correct": return "c"\n    return edit if step != "review"')]),
 # scheduler and holds
 "ED1 implement before review regardless of deadlines": (STA, [('        return (0 if client(s["roles"][j], cd[0]) == s["first"] else 1, 0 if cd[0] == "review" else 1)', '        return (0 if cd[0] == "impl" else 1,)')]),
 "ED2 a quota hold blocks every provider": (STA, [('            if p in s["qh"][j]:\n                continue', '            if s["qh"][j]:\n                continue')]),
 "ED3 not work-conserving (only the first candidate is tried)": (STA, [('                return s, out\n            if refused1 is None and not rule1(s, pi):\n                refused1 = p', '                return s, out\n            if refused1 is None and not rule1(s, pi):\n                refused1 = p\n            break')]),
 "H1a every refused provider gets a quota hold": (STA, [('            if refused1 is None and not rule1(s, pi):\n                refused1 = p', '            if not rule1(s, pi):\n                if refused1 is not None:\n                    s["qh"] = tset(s["qh"], j, s["qh"][j] | {refused1}); out.append(("hold", "quota", j, refused1))\n                refused1 = p')]),
 "C1a launch under an approval hold": (LED, [('        if s["infl"][j] is not None or s["ahold"][j] is not None:', '        if s["infl"][j] is not None:')]),
}

only = sys.argv[1:]


def run(mid, scope, text):
    f = HERE / ("mut4_" + mid + ".py"); f.write_text(text)
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
        for other in (LED, STA, Q1):
            if other == scope: continue
            v2, f2, l2, s2, c2 = run(mid, other, t)
            print(f"    also [{other}]: {v2} {f2} {l2} {s2} {c2}", flush=True)
            if v2 == "KILLED": break
