"""Mutation test for check52.py (model check M5.2), scopes periods52 and leaks52.

Each mutant changes the model part of check52.py only (decide and its
helpers), never a monitor or the search. leaks52 mutants run with
--safety-only, so its restatement checks (DC, K, UK) are not reported;
periods52 has none. A mutant is KILLED only by a property (TC in
periods52; AS, LK, ND in leaks52) or by a liveness deadlock (strict
liveness in leaks52, whose one-reset credit covers every state because
it has no reset). MISSED otherwise. Every missed mutant is printed with
exactly one classification, written in the CLASS table below:
  equivalent              equivalent in the full written design;
  safety-only equivalent  equivalent for safety, differs in liveness or holds;
  separate coverage       checked by another named model;
  missing coverage        no model checks it.
Runs are sequential: python3 -I, timeout 280, --stop.
Usage: python3 -I mutate52.py [ID...]
"""
import sys, subprocess, pathlib

HERE = pathlib.Path(__file__).resolve().parent
SRC = (HERE / "check52.py").read_text()
START = '        s["up"] = tset(s["up"], j, True)\n        g_settle(s, j, out, True)'
OPEN = '    s["lpt"] = s["pp"]\n'
MEMBER = '        if hasR and s["lq"] is None: s["lq"] = q\n'

M = {
 # ------------------------------------------------------------ periods52
 "PA1 revision 5.1's rule P: a charged step that ended before the old scheduled reset time stops counting at a new period":
   ("periods52", [(OPEN, OPEN + '    if q is not None: s["led"] = tuple(r[:PST] + ("r",) + r[PST + 1:] if r[PST] == "c" and r[PEB] else r for r in s["led"])\n')]),
 "PA2 a usage drop opens a period (revision 5.1), and the period's readings start over":
   ("periods52", [(MEMBER, MEMBER + '        if s["rds"] and used < p_read(s): p_open_period(s, s["lq"], (used, w)); return s, [("period", s["lp"])]\n')]),
 "PA3 the newest reading by wall-clock stamp is used instead of the highest":
   ("periods52", [('def p_read(s): return max(u for u, w in s["rds"])', 'def p_read(s): return max(s["rds"], key=lambda x: (x[1], x[0]))[0]')]),
 "PA4 the period's reading is the highest among fresh readings only (a stale reading leaves the period)":
   ("periods52", [('        s["fresh"] = False; return s, []', '        s["fresh"] = False; s["rds"] = (); return s, []')]),
 "PA5 freshness on the wall clock (a backward step makes stale readings fresh again)":
   ("periods52", [('        s["clk"] = max(0, s["clk"] - 1); s["backs"] += 1; return s, []',
                   '        s["clk"] = max(0, s["clk"] - 1); s["backs"] += 1; s["fresh"] = len(s["rds"]) > 0; return s, []')]),
 "PA6 a reading of an earlier period (by reset time) joins the current one":
   ("periods52", [('        if hasR and s["lq"] is not None and q < s["lq"]:\n            return s, [("dropped",)]\n', '')]),
 "GA8 no reading taken as zero use (Unknown as Allow)":
   ("periods52", [('def p_read(s): return max(u for u, w in s["rds"])', 'def p_read(s): return max((u for u, w in s["rds"]), default=0)'),
                  ('def p_usable(s): return len(s["rds"]) > 0 and s["fresh"] and not p_passed(s)',
                   'def p_usable(s): return len(s["rds"]) == 0 or (s["fresh"] and not p_passed(s))')]),
 "PA7 freshness ignored (a stale reading stays usable)":
   ("periods52", [('def p_usable(s): return len(s["rds"]) > 0 and s["fresh"] and not p_passed(s)',
                   'def p_usable(s): return len(s["rds"]) > 0 and not p_passed(s)')]),
 "PA8 a reading stays usable after the clock passes its period's reset time":
   ("periods52", [('def p_usable(s): return len(s["rds"]) > 0 and s["fresh"] and not p_passed(s)',
                   'def p_usable(s): return len(s["rds"]) > 0 and s["fresh"]')]),
 "PA9 every charged step stops counting at any new period (revision 5's own-period rule)":
   ("periods52", [(OPEN, OPEN + '    s["led"] = tuple(r[:PST] + ("r",) + r[PST + 1:] if r[PST] == "c" else r for r in s["led"])\n')]),
 "PA10 open grants left out of the level":
   ("periods52", [('def p_counts(r): return r[PST] in ("o", "c")', 'def p_counts(r): return r[PST] == "c"')]),
 "PA11 charged grants left out of the level (a reading taken to reflect them)":
   ("periods52", [('def p_counts(r): return r[PST] in ("o", "c")', 'def p_counts(r): return r[PST] == "o"')]),
 "PA12 a reading observed before `ledger reset` joins the period it opens":
   ("periods52", [('        if idx <= s["lobs"]:\n            return s, [("dropped",)]\n', '')]),
 # ------------------------------------------------------------ leaks52
 "GA4 no cancel after a lost race":
   ("leaks52", [('            g_row(s, g, st="x"); s["ph"] = tset(s["ph"], j, None); return s, [("cancel", g)]',
                 '            s["ph"] = tset(s["ph"], j, None); return s, []')]),
 "GA5 startup does not charge Finished-without-Charged":
   ("leaks52", [(START, '        s["up"] = tset(s["up"], j, True)\n        s["nochg"] = True; g_settle(s, j, out, True); del s["nochg"]'),
                ('        if e[0] == "F" or (kill and e[0] == "I"):', '        if (e[0] == "F" and not s.get("nochg")) or (kill and e[0] == "I"):')]),
 "GA6 a grant is charged again on redo":
   ("leaks52", [('        if e is None or s["led"][e[1]][ST] != "o": continue', '        if e is None or s["led"][e[1]][ST] == "x": continue')]),
 "GA9 no settle step at ordinary launch attempts":
   ("leaks52", [('    if k == "Run":\n        j = ev[1]\n        g_settle(s, j, out, False)\n', '    if k == "Run":\n        j = ev[1]\n')]),
 "GA10 startup does not cancel unnamed grants":
   ("leaks52", [(START, '        s["up"] = tset(s["up"], j, True)\n        s["nocan"] = True; g_settle(s, j, out, True); del s["nocan"]'),
                ('        if r[J] == j and r[ST] == "o" and g not in named:', '        if r[J] == j and r[ST] == "o" and g not in named and not s.get("nocan"):')]),
 "GA11 no Uncertain hold at startup":
   ("leaks52", [('                s["uh"] = tset(s["uh"], j, True); out.append(("hold", "uncertain", j, e[1]))', '                pass')]),
 "GA12 orphan test by operation (opId) instead of grantId":
   ("leaks52", [('    named = {e[1] for e in s["log"][j] if e is not None}',
                 '    named = {g for g, r in enumerate(s["led"]) if r[J] == j and s["log"][j][r[OP]] is not None}')]),
 "GB5 ledger settle charges Intended-without-Finished without killing it (the process may still run)":
   ("leaks52", [('        g_settle(s, j, out, False); return s, out',
                 '        g_settle(s, j, out, False)\n        for e in s["log"][j]:\n'
                 '            if e is not None and e[0] == "I" and s["led"][e[1]][ST] == "o": g_row(s, e[1], st="c"); out.append(("charge", e[1], EST))\n'
                 '        return s, out')]),
 "GB4 startup charges without killing the process first":
   ("leaks52", [('    if kill: g_kill(s, j, out)', '    pass')]),
 "GL1 a failed settle write does not end the launch attempt (admission goes on)":
   ("leaks52", [('        if k == "StartSF": g_kill(s, j, out)\n        return s, out + [("settlefail", j)]',
                 '        if k == "StartSF": g_kill(s, j, out)\n        if k == "RunSF" and not (s["uh"][j] or s["qh"][j]) and g_left(s, j) > 0 and g_allows(s):\n'
                 '            op = next(i for i, e in enumerate(s["log"][j]) if e is None); g = len(s["led"])\n'
                 '            s["led"] = s["led"] + ((j, op, s["lp"], "o", None, False, 0),); s["ph"] = tset(s["ph"], j, ("g", g))\n'
                 '            return s, out + [("launch", j, g)]\n'
                 '        return s, out + [("settlefail", j)]')]),
 "GL2 a startup whose settle write fails goes on running":
   ("leaks52", [('        if k == "StartSF": g_kill(s, j, out)\n        return s, out + [("settlefail", j)]',
                 '        if k == "StartSF": g_kill(s, j, out)\n        if k == "StartSF": s["up"] = tset(s["up"], j, True)\n        return s, out + [("settlefail", j)]')]),
}

# One classification per mutant, used only if it is MISSED (killed mutants need none).
CLASS = {
 "PA6": ("safety-only equivalent", "an earlier period's reading can only raise the period's highest reading, which refuses more launches; it never admits one the design refuses"),
 "PA8": ("safety-only equivalent", "after the reset time passes, the reading of the old period is still bounded by A5 and every unretired grant still counts, so admitting on it stays within TC; the rule costs liveness only. In the full design it also guards a reading taken as usable across a long gap with no reset time; A5 covers that only if the delay bound holds"),
 "GA4": ("safety-only equivalent", "the next settle step cancels the orphan; the immediate cancel frees room sooner, and in the text a lost race left open can cause a spurious Quota hold, which the model does not see"),
 "GA11": ("separate coverage", "the Uncertain hold protects git state, which M3 checks (C4); no ledger quantity changes"),
 "GA12": ("equivalent", "every grant has a fresh opId in the written design, so the opId and grantId tests agree"),
 "GL1": ("safety-only equivalent", "a launch after a failed settle write still counts every open grant at its estimate, so AS holds and the grants are settled at the next successful settle step; the text ends the attempt so that a failing ledger stops launches"),
}

only = sys.argv[1:]


def run(mid, scope, text):
    f = HERE / ("mut52_" + mid + ".py"); f.write_text(text)
    args = ["timeout", "280", "python3", "-I", str(f), scope, "--stop"] + (["--safety-only"] if scope == "leaks52" else [])
    r = subprocess.run(args, capture_output=True, text=True)
    f.unlink()
    lines = r.stdout.splitlines()
    found = [l for l in lines if l.startswith("FOUND")]
    key = "strict liveness" if scope == "leaks52" else "liveness:"
    live = [l for l in lines if l.startswith(key)]
    states = [l for l in lines if l.startswith("scope ")]
    dead = live and not live[0].rstrip(" states").endswith(": 0")
    if found: verdict = "KILLED by " + found[0].split()[1]
    elif dead: verdict = "KILLED by liveness"
    elif r.returncode == 124: verdict = "TIMEOUT"
    elif r.returncode != 0: verdict = "ERROR " + (r.stderr.strip().splitlines() or ["?"])[-1]
    else:
        c = CLASS.get(mid)
        verdict = "MISSED, " + (f"{c[0]}: {c[1]}" if c else "UNCLASSIFIED")
    return verdict, live, states


for name, (scope, reps) in M.items():
    mid = name.split()[0]
    if only and mid not in only: continue
    t = SRC
    for a, b in reps:
        assert t.count(a) == 1, (name, t.count(a), a)
        t = t.replace(a, b)
    verdict, live, states = run(mid, scope, t)
    print(f"[{scope}] {name}: {verdict} {live} {states}", flush=True)
