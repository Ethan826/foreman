import sys, os
SRC = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "check52.py")).read()
def load(text, name):
    sys.argv = ["x", "periods52"]; ns = {"__name__": name}; exec(compile(text, name, "exec"), ns); return ns
def run(c, trace, label, guard="model", lobs_zero=False):
    print("==", label)
    s, m = c["p_initial"](), c["pm_init"]()
    viol = False
    for ev in trace:
        evs, _ = c["p_events"](s)
        if ev[0] == "Ingest" and guard != "model":
            p = next(p for p in s["pend"] if p[0] == ev[1])
            newest = s["lsnap"] is None or p[0] > s["lsnap"][0]
            unseen = sum(1 for v in s["outs"] if v >= p[0]) if p[1] == s["pp"] else len(s["outs"])
            ok = (not newest) or unseen <= c["P_RES"]   # text's A5: only the newest ingested is constrained
            if not ok: print("   blocked by text A5:", ev); return
        elif ev not in evs:
            print("   not enabled under model guard:", ev); return
        if lobs_zero and ev[0] == "Ingest": s = dict(s); s["lobs"] = 0
        s, out = c["p_decide"](s, ev); m, v = c["pm_check"](m, ev, out)
        viol |= bool(v)
        print("  ", ev, out, "VIOL" if v else "", "fresh", s["fresh"], "tu", m["tu"])
    print("   TC", "VIOLATED" if viol else "holds on this trace")

# R1: ledger reset carries the highest (and freshness stamps) of readings ingested since the last
# period-opening reading; no capture-order exclusion (lobs unused).
old = '        p_open_period(s, None, None); s["lobs"] = s["nsnap"]   # amendment 5: readings observed before the command never join\n'
assert old in SRC
R1 = SRC.replace(old, '        rds, fr = s["rds"], s["fresh"]; p_open_period(s, None, None); s["rds"], s["fresh"] = rds, fr\n')
orig, r1 = load(SRC, "orig"), load(R1, "r1")
T1 = [("Reset",), ("Outside",), ("Snap", True), ("Outside",), ("Snap", False), ("Ingest", 2), ("LedgerReset",), ("Ingest", 1), ("Run", 0)]
run(orig, T1, "T1 written rule (observed-after joins)", lobs_zero=True)
run(r1, T1, "T1 with R1")
# T1b: R1 must also handle an old high reading without resetsAt arriving after the command, then a later lower one
T1b = [("Snap", False), ("Reset",), ("Snap", True), ("Ingest", 2), ("LedgerReset",), ("Ingest", 1), ("Run", 0)]
run(r1, T1b, "T1b with R1")
# T1c: ledger reset with nothing ingested beforehand; first reading after it is old (captured before outside use)
T1c = [("Reset",), ("Snap", True), ("Outside",), ("Outside",), ("LedgerReset",), ("Ingest", 1), ("Run", 0), ("Run", 1)]
run(r1, T1c, "T1c with R1, text A5 (guard newest only)", guard="text")
run(r1, T1c, "T1c with R1, provider-side A5 (model guard)")

PA6 = SRC.replace('        if hasR and s["lq"] is not None and q < s["lq"]:\n            return s, [("dropped",)]\n', '')
pa6 = load(PA6, "pa6")
T2 = [("Snap", True), ("Reset",), ("Snap", True), ("Ingest", 2), ("Stale",), ("Outside",), ("Outside",), ("Ingest", 1), ("Run", 0), ("Run", 1)]
run(pa6, T2, "T2 PA6 mutant, text A5", guard="text")
run(pa6, T2, "T2 PA6 mutant, provider-side A5 (R2)")
# T2': no mutant: same-period old reading, ingested late, refreshes freshness
T2s = [("Snap", True), ("Snap", True), ("Ingest", 2), ("Stale",), ("Outside",), ("Outside",), ("Ingest", 1), ("Run", 0), ("Run", 1)]
run(orig, T2s, "T2s unmutated, same period, text A5", guard="text")
run(orig, T2s, "T2s unmutated, provider-side A5 (R2)")
run(r1, T2s, "T2s R1, provider-side A5 (R2)")
