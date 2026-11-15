import sys, importlib.util
src = open(__import__("os").path.join(__import__("os").path.dirname(__import__("os").path.abspath(__file__)), "..", "check52.py")).read()
pa6 = src.replace('        if hasR and s["lq"] is not None and q < s["lq"]:\n            return s, [("dropped",)]\n', '')
assert pa6 != src
def load(text, name):
    sys.argv = ["x", "periods52"]; ns = {"__name__": name}; exec(compile(text, name, "exec"), ns); return ns
def run(c, trace):
    s, m = c["p_initial"](), c["pm_init"]()
    for ev in trace:
        evs, _ = c["p_events"](s)
        if ev[0] == "Ingest":
            p = next(p for p in s["pend"] if p[0] == ev[1])
            newest = s["lsnap"] is None or p[0] > s["lsnap"][0]
            print("   model guard enables:", ev in evs, "| design A5 constrains this arrival:", newest)
        else:
            assert ev in evs, (ev, evs)
        s, out = c["p_decide"](s, ev); m, v = c["pm_check"](m, ev, out)
        print(ev, out, v, "fresh", s["fresh"], "tu", m["tu"])
tr = [("Snap", True), ("Reset",), ("Snap", True), ("Ingest", 2), ("Stale",), ("Outside",), ("Outside",), ("Ingest", 1), ("Run", 0), ("Run", 1)]
print("== PA6 mutant"); run(load(pa6, "pa6"), tr)
print("== unmutated"); run(load(src, "orig"), tr)
