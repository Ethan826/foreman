# Brute-force oracle for the v0.2.0 restore. Fixed grammar (declared before the first run):
# paths a, b, d/x, d/y, e (file) or e/z (when e is a directory), k.log and d/k.log (ignored by *.log);
# each non-ignored path: absent | file v1 | file v2 | exec v1 | symlink->a. Ignored paths: absent | file.
# Trial: random base commit B (no ignored files), random S1 -> snapshot T1 (temp index: read-tree HEAD, add -A, write-tree),
# random S2, restore T1 (read-tree --reset -u T1; clean -fd; read-tree HEAD), fresh snapshot T'.
# Checks: T' == T1; HEAD unchanged; every ignored file of S2 still present with its content unless restore reported a difference.
import os, random, shutil, subprocess, sys, tempfile
random.seed(int(sys.argv[1]) if len(sys.argv) > 1 else 1)
TRIALS = int(sys.argv[2]) if len(sys.argv) > 2 else 300
ENV = dict(os.environ, HOME=tempfile.mkdtemp(), GIT_CONFIG_NOSYSTEM="1", GIT_AUTHOR_NAME="o", GIT_AUTHOR_EMAIL="o@o",
           GIT_COMMITTER_NAME="o", GIT_COMMITTER_EMAIL="o@o")
def git(repo, *args, env=None, check=True):
    r = subprocess.run(["git", "-C", repo, "-c", "core.hooksPath=/dev/null", *args], capture_output=True, text=True, env=env or ENV)
    if check and r.returncode != 0: raise RuntimeError(f"git {args}: {r.stderr}")
    return r
PLAIN = ["a", "b", "d/x", "d/y"]
KINDS = ["absent", "v1", "v2", "exec", "link"]
def rand_state(allow_ignored):
    st = {p: random.choice(KINDS) for p in PLAIN}
    st["e"] = random.choice(["absent", "v1", "dir"])          # e as file or as directory holding e/z
    st["e/z"] = random.choice(["v1", "v2"]) if st["e"] == "dir" else "absent"
    for p in ["k.log", "d/k.log", "e/k.log"]: st[p] = random.choice(["absent", "v1"]) if allow_ignored else "absent"
    if st["e"] == "v1": st["e/k.log"] = "absent"
    st[".gi"] = random.choice(["logs", "logs+b"])
    return st
def clear(repo):
    for n in os.listdir(repo):
        if n == ".git": continue
        p = os.path.join(repo, n)
        if os.path.isdir(p) and not os.path.islink(p): shutil.rmtree(p)
        else: os.remove(p)
def write(repo, st):
    clear(repo)
    with open(os.path.join(repo, ".gitignore"), "w") as f: f.write("*.log\n" + ("b\n" if st.get(".gi") == "logs+b" else ""))
    for p, k in st.items():
        if k in ("absent", "dir") or p == ".gi": continue
        full = os.path.join(repo, p); os.makedirs(os.path.dirname(full), exist_ok=True)
        if k == "link": os.symlink("a", full); continue
        with open(full, "w") as f: f.write(f"{p}:{k}\n")
        if k == "exec": os.chmod(full, 0o755)
def snapshot(repo):
    idx = tempfile.mktemp(); env = dict(ENV, GIT_INDEX_FILE=idx)
    git(repo, "read-tree", "HEAD", env=env); git(repo, "add", "-A", env=env)
    t = git(repo, "write-tree", env=env).stdout.strip(); os.remove(idx); return t
def ignored_files(repo):
    names = git(repo, "ls-files", "-z", "--others", "--ignored", "--exclude-standard").stdout.split("\0")
    out = {}
    for p in names:
        full = os.path.join(repo, p)
        if p and os.path.isfile(full) and not os.path.islink(full): out[p] = open(full).read()
    return out
def precheck(repo, tree, ignored):
    entries = {}
    for line in git(repo, "ls-tree", "-r", "-t", "-z", tree).stdout.split("\0"):
        if line: meta, path = line.split("\t", 1); entries[path] = meta.split()[1]
    bad = []
    for p in ignored:
        parts = p.split("/")
        prefixes = ["/".join(parts[:i]) for i in range(1, len(parts) + 1)]
        if any(entries.get(q) not in (None, "tree") for q in prefixes) or entries.get(p) == "tree": bad.append(p)
    return bad
results = {"exact": 0, "mismatch": 0, "error": 0, "ignored_lost": 0, "head_moved": 0, "refused": 0, "refused_but_no_loss": 0}
examples = []
for i in range(TRIALS):
    repo = tempfile.mkdtemp(); git(repo, "init", "-q", "-b", "main")
    base = rand_state(False); write(repo, base); git(repo, "add", "-A"); git(repo, "commit", "-q", "--allow-empty", "-m", "base")
    head = git(repo, "rev-parse", "HEAD").stdout.strip()
    s1 = rand_state(True); write(repo, s1); t1 = snapshot(repo)
    s2 = rand_state(True); write(repo, s2); ign2 = ignored_files(repo)
    bad = precheck(repo, t1, ign2)
    cur = snapshot(repo)
    gi_t = git(repo, "rev-parse", f"{t1}:.gitignore", check=False).stdout.strip()
    gi_c = git(repo, "rev-parse", f"{cur}:.gitignore", check=False).stdout.strip()
    if gi_t != gi_c: bad = bad + [".gitignore differs"]
    if bad:
        results["refused"] += 1
        # would the unguarded restore have lost them? run it anyway to classify the refusal
        git(repo, "read-tree", "--reset", "-u", t1); git(repo, "clean", "-fd"); git(repo, "read-tree", "HEAD")
        now = {p: open(os.path.join(repo, p)).read() for p in ign2 if os.path.isfile(os.path.join(repo, p)) and not os.path.islink(os.path.join(repo, p))}
        if all(now.get(p) == ign2[p] for p in ign2): results["refused_but_no_loss"] += 1; examples.append(("refused_no_loss", base, s1, s2, bad))
        shutil.rmtree(repo); continue
    err = None
    try:
        git(repo, "read-tree", "--reset", "-u", t1); git(repo, "clean", "-fd"); git(repo, "read-tree", "HEAD")
    except RuntimeError as e: err = str(e)
    if err:
        results["error"] += 1; examples.append(("error", base, s1, s2, err[:200])); continue
    tp = snapshot(repo)
    if git(repo, "rev-parse", "HEAD").stdout.strip() != head: results["head_moved"] += 1
    if tp == t1: results["exact"] += 1
    else:
        results["mismatch"] += 1
        diff = git(repo, "diff-tree", "-r", "--name-status", t1, tp).stdout.strip().replace("\n", "; ")
        examples.append(("mismatch", base, s1, s2, diff))
    lost = [p for p, c in ign2.items() if not (os.path.isfile(os.path.join(repo, p)) and not os.path.islink(os.path.join(repo, p)) and open(os.path.join(repo, p)).read() == c)]
    if lost: results["ignored_lost"] += 1; examples.append(("ignored_lost", base, s1, s2, lost))
    shutil.rmtree(repo)
print(results)
seen = set()
for kind, b, s1, s2, info in examples:
    if (kind, str(info)[:60]) in seen: continue
    seen.add((kind, str(info)[:60]))
    print(kind, "| info:", info, "\n  base:", {k: v for k, v in b.items() if v != "absent"},
          "\n  S1:", {k: v for k, v in s1.items() if v != "absent"}, "\n  S2:", {k: v for k, v in s2.items() if v != "absent"})
    if len(seen) >= 8: break
