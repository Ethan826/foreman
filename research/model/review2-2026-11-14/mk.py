import sys, pathlib
H = pathlib.Path(__file__).resolve().parent
SRC = (H / "check2.py").read_text()
def mk(name, reps):
    t = SRC
    for a, b in reps:
        assert t.count(a) == 1, (name, t.count(a), a)
        t = t.replace(a, b)
    (H / (name + ".py")).write_text(t)

# T1: text says a restart expires an armed waiver; model and monitor keep it across Start.
mk("T1", [('            s["lock"] = i; out.append(("started", i))',
           '            s["lock"] = i; out.append(("started", i)); s["waiver"] = None')])

# T2: literal startup rule: any op with Intended and no Finished (or Finished(success) and no
# commit outcome) gets Uncertain at every startup, even after it was reconciled.
mk("T2", [('                allowp=False, lock="A",', '                allowp=False, ghost=False, lock="A",'),
          ('            if s["inflight"] and s["orphan"] and ("uncertain",) not in s["holds"]:',
           '            if ((s["inflight"] and s["orphan"]) or s["ghost"]) and ("uncertain",) not in s["holds"]:'),
          ('        if ("uncertain",) in s["holds"] and s["inflight"]:\n            step, stage, base, _ = s["inflight"]',
           '        if ("uncertain",) in s["holds"] and s["inflight"]:\n            step, stage, base, _ = s["inflight"]; s["ghost"] = True')])

# E1 (grammar amendment, labelled): a failed mutating step may also tamper .git/config.
# Design text: digests are compared only inside the commit procedure (successful steps), with the
# baseline taken at step start; reset/clean do not touch .git. Monitor property P2: no shell git
# commit runs while an unpermitted tamper is outstanding.
mk("E1", [('                allowp=False, lock="A",', '                allowp=False, tamper=False, dbase=False, lock="A",'),
          ('    s["inflight"] = (step, "running", base, None); s["orphan"] = False',
           '    s["inflight"] = (step, "running", base, None); s["orphan"] = False; s["dbase"] = s["tamper"]'),
          ('            kinds = (("changed", "nochange", "protected", "rateLimited", "failed")',
           '            kinds = (("changed", "nochange", "protected", "rateLimited", "failed", "failedTamper")'),
          ('            else:\n                s["dirty"] = True; s["inflight"] = None\n                s["holds"] |= {("failure",)}; out.append(("hold", ("failure",), "failed"))',
           '            else:\n                if kind == "failedTamper" and not s["allowp"]: s["tamper"] = True\n                s["dirty"] = True; s["inflight"] = None\n                s["holds"] |= {("failure",)}; out.append(("hold", ("failure",), "failed"))'),
          ('        if s["head"] != base:\n            s["inflight"] = None',
           '        if s["tamper"] != s["dbase"]:\n            s["inflight"] = None\n            s["holds"] |= {("failure",)}; out.append(("hold", ("failure",), "protectedPath"))\n        elif s["head"] != base:\n            s["inflight"] = None'),
          ('                crash_ob=False, fail_ob=False, drift_ob=False,',
           '                crash_ob=False, fail_ob=False, drift_ob=False, mtamper=False,'),
          ('                else:  # failed, or protected without permission\n',
           '                else:  # failed, or protected without permission\n                    if kind == "failedTamper" and not m["allowp"]: m["mtamper"] = True\n'),
          ('        gc = [o[1] for o in out if o[0] == "gitcommit"]',
           '        gc = [o[1] for o in out if o[0] == "gitcommit"]\n        if gc and m["mtamper"]: bad("P2 shell git commit ran with tampered .git/config")'),
          ])
print("ok")
