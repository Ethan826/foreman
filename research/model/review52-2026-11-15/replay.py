import sys, importlib.util
spec = importlib.util.spec_from_file_location("c52", __import__("os").path.join(__import__("os").path.dirname(__import__("os").path.abspath(__file__)), "..", "check52.py"))
sys.argv = ["x", "periods52"]
c = importlib.util.module_from_spec(spec); spec.loader.exec_module(c)
DESIGN = "--design" in sys.argv[1:] or True
def run(trace, design_rule):
    s, m = c.p_initial(), c.pm_init()
    for ev in trace:
        evs, _ = c.p_events(s)
        assert ev in evs, (ev, evs)
        if design_rule and ev[0] == "Ingest":
            s = dict(s); s["lobs"] = 0   # design rule: a reading observed (delivered) after ledger reset joins, whatever its as-of
        s, out = c.p_decide(s, ev)
        m, v = c.pm_check(m, ev, out)
        print(ev, out, v, "level", c.p_level(s) if s["rds"] else None, "tu", m["tu"])
tr = [("Reset",), ("Outside",), ("Snap", True), ("Outside",), ("Snap", False), ("Ingest", 2), ("LedgerReset",), ("Ingest", 1), ("Run", 0)]
print("model rule:"); 
try: run(tr, False)
except AssertionError as e: print("not enabled", e)
print("design rule (observed after reset joins):"); run(tr, True)
