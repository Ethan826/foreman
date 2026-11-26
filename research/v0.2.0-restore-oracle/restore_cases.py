# Targeted cases for the restore; every git call is git -C <absolute temp repo>.
import os, shutil, subprocess, tempfile, stat
H = tempfile.mkdtemp()
ENV = dict(os.environ, HOME=H, GIT_CONFIG_NOSYSTEM="1", GIT_AUTHOR_NAME="o", GIT_AUTHOR_EMAIL="o@o", GIT_COMMITTER_NAME="o", GIT_COMMITTER_EMAIL="o@o")
def git(repo, *a, env=None, check=True):
    assert repo.startswith(tempfile.gettempdir()) or repo.startswith("/private/var") or repo.startswith("/var"), repo
    r = subprocess.run(["git", "-C", repo, "-c", "core.hooksPath=/dev/null", *a], capture_output=True, text=True, env=env or ENV)
    if check and r.returncode: raise RuntimeError(f"{a}: {r.stderr.strip()}")
    return r
def snap(repo):
    idx = tempfile.mktemp(); e = dict(ENV, GIT_INDEX_FILE=idx)
    git(repo, "read-tree", "HEAD", env=e); git(repo, "add", "-A", env=e); t = git(repo, "write-tree", env=e).stdout.strip(); os.remove(idx); return t
def restore(repo, t):
    git(repo, "read-tree", "--reset", "-u", t); git(repo, "clean", "-fd"); git(repo, "read-tree", "HEAD")
def W(repo, p, c="x\n", mode=None):
    f = os.path.join(repo, p); os.makedirs(os.path.dirname(f), exist_ok=True); open(f, "w").write(c)
    if mode: os.chmod(f, mode)
def clear(repo):
    for n in os.listdir(repo):
        if n == ".git": continue
        p = os.path.join(repo, n)
        if os.path.isdir(p) and not os.path.islink(p): shutil.rmtree(p)
        else: os.remove(p)
def case(name, base, s1, s2, extra_check=None):
    repo = tempfile.mkdtemp(); git(repo, "init", "-q", "-b", "main")
    base(repo); git(repo, "add", "-A"); git(repo, "commit", "-q", "--allow-empty", "-m", "b"); head = git(repo, "rev-parse", "HEAD").stdout.strip()
    s1(repo); t1 = snap(repo); s2(repo)
    try: restore(repo, t1); err = None
    except RuntimeError as e: err = str(e)
    if err: print(f"{name}: RESTORE ERROR {err[:150]}"); return
    try: tp = snap(repo)
    except RuntimeError as e: print(f"{name}: SNAPSHOT ERROR {str(e)[:150]}"); return
    d = git(repo, "diff-tree", "-r", "--name-status", t1, tp).stdout.strip().replace("\n", "; ")
    moved = git(repo, "rev-parse", "HEAD").stdout.strip() != head
    x = extra_check(repo) if extra_check else ""
    print(f"{name}: {'EXACT' if tp == t1 else 'MISMATCH ' + d}{' HEAD-MOVED' if moved else ''} {x}")
def nothing(r): pass
# 1 mode-only change: target has a.sh executable, current not
case("mode-only", lambda r: W(r, "a.sh"), lambda r: os.chmod(os.path.join(r, "a.sh"), 0o755), lambda r: os.chmod(os.path.join(r, "a.sh"), 0o644))
# 2 symlink in target where current has a directory
def s1_link(r): os.symlink("x", os.path.join(r, "L"))
def s2_dir(r):
    os.remove(os.path.join(r, "L")); W(r, "L/f", "y\n")
case("target-symlink-current-dir", nothing, s1_link, s2_dir)
# 3 directory in target where current has a symlink to a directory holding files outside
outside = tempfile.mkdtemp(); W(outside, "keep.txt", "outside\n")
def s1_dir(r): W(r, "D/f", "in\n")
def s2_link(r):
    shutil.rmtree(os.path.join(r, "D")); os.symlink(outside, os.path.join(r, "D"))
case("target-dir-current-symlinked-dir", nothing, s1_dir, s2_link, lambda r: "outside-kept" if os.path.isfile(os.path.join(outside, "keep.txt")) else "OUTSIDE-FILE-DELETED")
# 4 case-only rename (macOS case-insensitive)
case("case-only-rename", lambda r: W(r, "Readme.md"), nothing, lambda r: (os.rename(os.path.join(r, "Readme.md"), os.path.join(r, "tmp")), os.rename(os.path.join(r, "tmp"), os.path.join(r, "README.md"))),
     lambda r: "names=" + ",".join(sorted(n for n in os.listdir(r) if n != ".git")))
# 5 nested .gitignore in subdir added by later state (pre-check would refuse; check unguarded behaviour)
case("nested-gitignore-added", lambda r: W(r, "sub/a.txt"), nothing, lambda r: (W(r, "sub/.gitignore", "*.tmp\n"), W(r, "sub/k.tmp", "t\n")),
     lambda r: "k.tmp " + ("kept" if os.path.exists(os.path.join(r, "sub/k.tmp")) else "DELETED"))
# 6 unremovable untracked file (read-only directory)
def s2_ro(r):
    W(r, "ro/new.txt", "n\n"); os.chmod(os.path.join(r, "ro"), 0o555)
case("unremovable-untracked", lambda r: W(r, "ro/keep.txt"), nothing, s2_ro)
# 7 untracked dir whose contents become ignored by an info/exclude change after target
def s2_excl(r):
    W(r, "z.txt", "z\n"); open(os.path.join(r, ".git/info/exclude"), "a").write("z.txt\n")
case("info-exclude-added-target-has-file", nothing, lambda r: W(r, "z.txt", "z\n"), s2_excl)
