"""Read Codex rate limits through `codex app-server` once.

Sends exactly: initialize (id 1), the initialized notification, and
account/rateLimits/read (id 2). Any other method is refused. Writes every
line the server prints to the output file, then closes stdin and waits.
"""
import json
import subprocess
import sys
import time

ALLOWED = {"initialize", "initialized", "account/rateLimits/read"}
out_path = sys.argv[1]
msgs = [
    {"jsonrpc": "2.0", "id": 1, "method": "initialize",
     "params": {"clientInfo": {"name": "foreman-l2", "version": "0.0.1"}}},
    {"jsonrpc": "2.0", "method": "initialized"},
    {"jsonrpc": "2.0", "id": 2, "method": "account/rateLimits/read", "params": None},
]
assert all(m["method"] in ALLOWED for m in msgs)

p = subprocess.Popen(["codex", "app-server"], stdin=subprocess.PIPE,
                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
lines = []
def send(m):
    p.stdin.write(json.dumps(m) + "\n")
    p.stdin.flush()

def read_until(id_, timeout=30):
    end = time.time() + timeout
    while time.time() < end:
        line = p.stdout.readline()
        if not line:
            return None
        lines.append(line)
        try:
            o = json.loads(line)
        except ValueError:
            continue
        if o.get("id") == id_:
            return o
    return None

send(msgs[0])
r1 = read_until(1)
if r1 is None or "error" in r1:
    print("initialize failed", r1)
else:
    send(msgs[1])
    send(msgs[2])
    r2 = read_until(2)
    print("read ok" if r2 and "result" in r2 else f"read failed {r2}")
p.stdin.close()
try:
    p.wait(timeout=15)
except subprocess.TimeoutExpired:
    p.terminate()
    p.wait(timeout=5)
with open(out_path, "w") as f:
    f.writelines(lines)
print("rc", p.returncode, "lines", len(lines))
