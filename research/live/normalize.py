"""Write whitelisted copies of the L1 and L2 raw outputs.

Only named fields are copied; everything else (session, account, host,
installation, path, hook output and message text) is dropped.
Usage: normalize.py <raw live dir> <repo research/live dir> <date>
"""
import json
import os
import re
import sys

raw, dest, day = sys.argv[1], sys.argv[2], sys.argv[3]
l1 = os.path.join(dest, f"l1-{day}")
l2 = os.path.join(dest, f"l2-{day}")
os.makedirs(l1, exist_ok=True)
os.makedirs(l2, exist_ok=True)


def jl(path):
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                yield json.loads(line)


def dump(path, rows):
    with open(path, "w") as f:
        for r in rows:
            f.write(json.dumps(r, sort_keys=True) + "\n")


def pick(d, keys):
    return {k: d[k] for k in keys if k in d}


# L1 statusline: capture time and rate_limits only, consecutive duplicates dropped.
rows, last = [], None
for o in jl(os.path.join(raw, "l1", "statusline.jsonl")):
    r = {"capturedAt": o.get("capturedAt"), "rate_limits": o.get("rate_limits")}
    key = json.dumps(r["rate_limits"], sort_keys=True)
    if key != last:
        rows.append(r)
        last = key
dump(os.path.join(l1, "statusline.jsonl"), rows)

# L1 stream: message types in order; rate_limit_event info; result usage.
rows = []
for o in jl(os.path.join(raw, "l1", "l1-stream.jsonl")):
    t = o.get("type")
    r = {"type": t}
    if o.get("subtype"):
        r["subtype"] = o["subtype"]
    if t == "system" and o.get("subtype") == "init":
        r.update(pick(o, ["claude_code_version", "model"]))
    if t == "rate_limit_event":
        r["rate_limit_info"] = o.get("rate_limit_info")
    if t == "result":
        r.update(pick(o, ["is_error", "num_turns", "total_cost_usd", "usage", "modelUsage"]))
    rows.append(r)
dump(os.path.join(l1, "l1-stream.jsonl"), rows)

# L1 /usage: result fields plus only the lines that state a window.
o = json.load(open(os.path.join(raw, "l1", "l1-usage.json")))
text = o.get("result") or ""
windows = [re.sub(r"\([A-Za-z_]+/[A-Za-z_/]+\)", "(local time)", ln.strip())
           for ln in text.splitlines()
           if re.match(r"\s*Current (session|week)", ln)]
dump(os.path.join(l1, "l1-usage.jsonl"), [{
    **pick(o, ["type", "subtype", "is_error", "num_turns", "total_cost_usd", "usage"]),
    "window_lines": windows,
}])

# L2 reads: the rate-limit result fields only; notification method names only.
for name in ("before", "after"):
    rows = []
    for o in jl(os.path.join(raw, "l2", f"l2-read-{name}.jsonl")):
        if "method" in o:
            rows.append({"notification": o["method"]})
        elif o.get("id") == 2 and "result" in o:
            res = o["result"]
            rows.append({"response": "account/rateLimits/read", **pick(
                res, ["rateLimits", "rateLimitsByLimitId", "ordinaryUsageAllowed"])})
        elif o.get("id") == 1:
            rows.append({"response": "initialize"})
    for r in rows:
        for snap in [r.get("rateLimits")] + list((r.get("rateLimitsByLimitId") or {}).values()):
            if isinstance(snap, dict):
                for k in ("planType", "credits", "individualLimit", "rateLimitUpsell"):
                    snap.pop(k, None)
    dump(os.path.join(l2, f"l2-read-{name}.jsonl"), rows)

# L2 exec: event types, item types and turn usage only (no message text).
rows = []
for o in jl(os.path.join(raw, "l2", "l2-exec.jsonl")):
    r = {"type": o.get("type")}
    if isinstance(o.get("item"), dict):
        r["item_type"] = o["item"].get("type")
    if "usage" in o:
        r["usage"] = o["usage"]
    rows.append(r)
dump(os.path.join(l2, "l2-exec.jsonl"), rows)
print("written", l1, l2)
