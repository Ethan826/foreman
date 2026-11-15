"""Mutation test for check5.py (model check M5).

Each mutant changes the model part of check5.py only (decide and its
helpers), never the monitor or the search. A mutant is KILLED if its run
reports a safety violation or a liveness deadlock, MISSED otherwise. Each
mutant names the scope it is run in first; a stages mutant missed there is
run in queue5 too. Runs are sequential: python3 -I, timeout 280, --stop.
Usage: python3 -I mutate5.py [ID...]
"""
import sys, subprocess, pathlib

HERE = pathlib.Path(__file__).resolve().parent
SRC = (HERE / "check5.py").read_text()
GR, ST, Q5 = "grants", "stages5", "queue5"

M = {
 # rule A: open grants, reflection, leaks, periods, Unknown
 "GA1 open grants (of other projects) ignored by the level": (GR, [('        if st == "o": lv += EST\n        elif st == "c" and g not in s["rrefl"]', '        if st == "o": lv += 0\n        elif st == "c" and g not in s["rrefl"]')]),
 "GA2 a lagged reading reflects every settled grant": (GR, [('        s["rused"] = s["out"] + s["fullfin"]; s["rout"] = s["out"]; s["rok"] = not s["passed"]\n        if g_allows', '        s["rused"] = s["out"] + s["fullfin"]; s["rout"] = s["out"]; s["rok"] = not s["passed"]\n        s["rrefl"] = frozenset(g for g, r in enumerate(s["led"]) if r[3] == "c" and r[2] == s["per"])\n        if g_allows')]),
 "GA3 a reflected settled grant is counted again": (GR, [('        elif st == "c" and g not in s["rrefl"]: lv += cost', '        elif st == "c": lv += cost')]),
 "GA4 no cancel after a lost race": (GR, [('            g_setrow(s, g, "x", 0); s["ph"] = tset(s["ph"], j, None); return s, [("cancel", g)]', '            s["ph"] = tset(s["ph"], j, None); return s, []')]),
 "GA5 startup does not charge Finished-without-Charged": (GR, [('def g_settle(s, j, out):', 'def g_settle(s, j, out, charge=True):'), ('        if e is not None and e[0] == "F" and s["led"][e[1]][3] == "o":', '        if charge and e is not None and e[0] == "F" and s["led"][e[1]][3] == "o":'), ('        s["up"] = tset(s["up"], j, True)\n        g_settle(s, j, out)', '        s["up"] = tset(s["up"], j, True)\n        g_settle(s, j, out, False)')]),
 "GA6 a grant is charged again on redo": (GR, [('        if e is not None and e[0] == "F" and s["led"][e[1]][3] == "o":', '        if e is not None and e[0] == "F" and s["led"][e[1]][3] != "x":')]),
 "GA7 launch after the reset-time release without a reading": (GR, [('        s["passed"] = True; s["rok"] = False\n', '        s["passed"] = True\n')]),
 "GA8 Unknown (no usable reading) treated as allow": (GR, [('def g_allows(s): return s["rok"] and g_level(s) + EST <= G_CAP', 'def g_allows(s): return g_level(s) + EST <= G_CAP')]),
 "GA9 no settle-first step on ordinary attempts": (GR, [('        j = ev[1]\n        g_settle(s, j, out)\n        if s["uh"][j]', '        j = ev[1]\n        if s["uh"][j]')]),
 "GA10 startup does not cancel unnamed grants": (GR, [('def g_settle(s, j, out):', 'def g_settle(s, j, out, cancel=True):'), ('        if jj == j and st == "o" and g not in named:', '        if cancel and jj == j and st == "o" and g not in named:'), ('        s["up"] = tset(s["up"], j, True)\n        g_settle(s, j, out)', '        s["up"] = tset(s["up"], j, True)\n        g_settle(s, j, out, False)')]),
 "GA11 no Uncertain hold at startup": (GR, [('            if e is not None and e[0] == "I" and not s["uh"][j]:', '            if False:')]),
 # B1 stop-before
 "SB1 a stop-before entry is treated as an approval": (ST, [('def plain(s, j, t): return (t, False) in s["pre"][j]', 'def plain(s, j, t): return (t, False) in s["pre"][j] or (t, True) in s["pre"][j]')]),
 "SB2 Approve does not consume the stop-before entry": (ST, [('                s["pre"] = tset(s["pre"], j, s["pre"][j] - {(t + 1, True)})\n', '')]),
 # B2 waivers
 "WV1 a waiver applies to another provider's step": (ST, [('                wc = [cd for cd in cands if client(s["roles"][j], cd[0]) == w]', '                wc = cands'), ('                    do_launch(s, j, wc[0], w, True, out); return s, out', '                    do_launch(s, j, wc[0], client(s["roles"][j], wc[0][0]), True, out); return s, out')]),
 "WV2 a waiver survives an attempt": (ST, [('            s["wv"] = tset(s["wv"], j, None)\n            if s["ahold"][j] is None:', '            if s["ahold"][j] is None:')]),
 "WV3 a waiver accepted without a quota hold": (ST, [('        if p in s["qh"][j] and s["wv"][j] is None:', '        if s["wv"][j] is None:')]),
 # B3 spend-down levels
 "SD5a a tightening spend-down skips rule 2": (ST, [('    if s["ovr"][pi] is not None and s["ovr"][pi] > U - RESERVE:\n        return True', '    if s["ovr"][pi] is not None:\n        return True')]),
 "SD5b a loosening spend-down keeps rule 2": (ST, [('    if s["ovr"][pi] is not None and s["ovr"][pi] > U - RESERVE:\n        return True', '    if False:\n        return True')]),
 "SD6 SpendDownCancel does not end the spend-down": (ST, [('            s["ovr"] = tset(s["ovr"], pi, None)\n            return s, [("spenddown_canceled"', '            return s, [("spenddown_canceled"')]),
 # B4 backlog removal
 "BR1 a removed backlog entry is still used": (ST, [('            s["pre"] = tset(s["pre"], j, s["pre"][j] - {(t, False), (t, True)})\n            return s, [("removed", j, t)]', '            return s, [("removed", j, t)]')]),
 "BR2 removal accepted for a started tranche": (ST, [('        if not started(s, j, t) and has_entry(s, j, t):', '        if has_entry(s, j, t):')]),
}

only = sys.argv[1:]


def run(mid, scope, text):
    f = HERE / ("mut5_" + mid + ".py"); f.write_text(text)
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
    if verdict != "KILLED" and scope == ST:
        v2, f2, l2, s2, c2 = run(mid, Q5, t)
        print(f"    also [{Q5}]: {v2} {f2} {l2} {s2} {c2}", flush=True)
