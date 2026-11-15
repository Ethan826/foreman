"""Mutation test for check51.py (model check M5.1), scope grants51.

Each mutant changes the model part of check51.py only (decide and its
helpers), never the monitor or the search. Every mutant is run with
--safety-only, so the restatement checks (DC, K, UK) are not reported: a
mutant is KILLED only by a property (AS, LK, ND) or by a liveness
deadlock, and the report names the property. MISSED otherwise. Runs are
sequential: python3 -I, timeout 280, --stop.
Usage: python3 -I mutate51.py [ID...]
"""
import sys, subprocess, pathlib

HERE = pathlib.Path(__file__).resolve().parent
SRC = (HERE / "check51.py").read_text()
GR = "grants51"
START = '        s["up"] = tset(s["up"], j, True)\n        g_settle(s, j, out, True)'

M = {
 "GA1 open grants (of every project) left out of the level":
   [('    return s["rd"][1] + sum(EST for r in s["led"] if g_counts(s, r))',
     '    return s["rd"][1] + sum(EST for r in s["led"] if g_counts(s, r) and r[ST] != "o")')],
 "GA2 a charged step is taken as reflected by the reading (revision 5's reflection test at its loosest)":
   [('    return s["rd"][1] + sum(EST for r in s["led"] if g_counts(s, r))',
     '    return s["rd"][1] + sum(EST for r in s["led"] if g_counts(s, r) and r[ST] != "c")')],
 "GA4 no cancel after a lost race":
   [('            g_row(s, g, st="x"); s["ph"] = tset(s["ph"], j, None); return s, [("cancel", g)]',
     '            s["ph"] = tset(s["ph"], j, None); return s, []')],
 "GA5 startup does not charge Finished-without-Charged":
   [(START, '        s["up"] = tset(s["up"], j, True)\n        s["nochg"] = True; g_settle(s, j, out, True); del s["nochg"]'),
    ('        if e[0] == "F" or (kill and e[0] == "I"):', '        if (e[0] == "F" and not s.get("nochg")) or (kill and e[0] == "I"):')],
 "GA6 a grant is charged again on redo":
   [('        if e is None or s["led"][e[1]][ST] != "o": continue', '        if e is None or s["led"][e[1]][ST] == "x": continue')],
 "GA7 a reading of a passed provider period stays usable":
   [('    return s["rd"] is not None and s["rok"] and s["rd"][0] == s["pp"] and s["rd"][0] == s["lpp"]',
     '    return s["rd"] is not None and s["rok"] and s["rd"][0] == s["lpp"]')],
 "GA8 no reading taken as zero use (Unknown as Allow)":
   [('def g_allows(s): return g_usable(s) and g_level(s) + EST <= G_CAP',
     'def g_allows(s): return (g_level(s) if s["rd"] is not None else sum(EST for r in s["led"] if g_counts(s, r))) + EST <= G_CAP and (s["rd"] is None or g_usable(s))'),
    # the counter below reads the reading at a launch; guarded so the mutant can run (instrumentation only)
    ('            if s["rd"][1] < s["tu"]: cnt["launch_on_delayed_reading"] += 1',
     '            if s["rd"] is not None and s["rd"][1] < s["tu"]: cnt["launch_on_delayed_reading"] += 1')],
 "GA9 no settle step at ordinary launch attempts":
   [('        j = ev[1]\n        g_settle(s, j, out, False)\n', '        j = ev[1]\n')],
 "GA10 startup does not cancel unnamed grants":
   [(START, '        s["up"] = tset(s["up"], j, True)\n        s["nocan"] = True; g_settle(s, j, out, True); del s["nocan"]'),
    ('        if r[J] == j and r[ST] == "o" and g not in named:', '        if r[J] == j and r[ST] == "o" and g not in named and not s.get("nocan"):')],
 "GA11 no Uncertain hold at startup":
   [('                s["uh"] = tset(s["uh"], j, True); out.append(("hold", "uncertain", j, e[1]))',
     '                pass')],
 "GA12 orphan test by operation (opId) instead of grantId":
   [('    named = {e[1] for e in s["log"][j] if e is not None}',
     '    named = {g for g, r in enumerate(s["led"]) if r[J] == j and s["log"][j][r[OP]] is not None}')],
 "GB1 an open grant counts only in its own period":
   [('    return r[LP] == s["lp"] or r[ST] == "o" or (r[FPP] is not None and r[FPP] > s["plpp"])',
     '    return r[LP] == s["lp"] or (r[FPP] is not None and r[FPP] > s["plpp"])')],
 "GB2 a step that spans the reset is not carried (revision 5's rule: own period only)":
   [('    return r[LP] == s["lp"] or r[ST] == "o" or (r[FPP] is not None and r[FPP] > s["plpp"])',
     '    return r[LP] == s["lp"] or r[ST] == "o"')],
 "GB3 ledger settle leaves Intended-without-Finished open (revision 5's rule)":
   [('        g_settle(s, j, out, True); return s, out', '        g_kill(s, j, out); g_settle(s, j, out, False); return s, out')],
 "GB4 startup charges without killing the process first":
   [('    if kill: g_kill(s, j, out)', '    pass')],
}

only = sys.argv[1:]


def run(mid, text):
    f = HERE / ("mut51_" + mid + ".py"); f.write_text(text)
    r = subprocess.run(["timeout", "280", "python3", "-I", str(f), GR, "--stop", "--safety-only"],
                       capture_output=True, text=True)
    f.unlink()
    lines = r.stdout.splitlines()
    found = [l for l in lines if l.startswith("FOUND")]
    live = [l for l in lines if l.startswith("liveness:")]
    states = [l for l in lines if l.startswith("scope ")]
    dead = live and not live[0].endswith(": 0")
    if found: verdict = "KILLED by " + found[0].split()[1]
    elif dead: verdict = "KILLED by liveness"
    elif r.returncode == 124: verdict = "TIMEOUT"
    elif r.returncode != 0: verdict = "ERROR " + (r.stderr.strip().splitlines() or ["?"])[-1]
    else: verdict = "MISSED"
    return verdict, found[:1], live, states


for name, reps in M.items():
    mid = name.split()[0]
    if only and mid not in only: continue
    t = SRC
    for a, b in reps:
        assert t.count(a) == 1, (name, t.count(a), a)
        t = t.replace(a, b)
    verdict, found, live, states = run(mid, t)
    print(f"{name}: {verdict} {found} {live} {states}", flush=True)
