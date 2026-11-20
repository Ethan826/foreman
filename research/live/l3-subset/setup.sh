#!/bin/bash
# L3 subset: create the disposable repository, its linked worktree and the
# rendered Claude settings under a scratch directory. Runs no agent client.
#
# Usage: setup.sh <scratch-dir> [--temp-ok]
#
# <scratch-dir> must be an absolute path to an existing directory that is
# not inside any git repository. A path under a temporary directory is
# refused unless --temp-ok is given: Claude's Bash sandbox may allow
# writes under temporary directories, which would hide an outside write in
# the live run (plan.md, "Scratch location"). --temp-ok is for testing
# these scripts only.
#
# Idempotent: a completed setup is left as it is; a partial one is refused
# with a pointer to teardown.sh.
set -eu

here=$(cd "$(dirname "$0")" && pwd -P)
template="$here/claude-settings.json"

if [ $# -lt 1 ] || [ $# -gt 2 ]; then
  echo "usage: setup.sh <scratch-dir> [--temp-ok]" >&2
  exit 2
fi
temp_ok=no
if [ $# -eq 2 ]; then
  if [ "$2" != "--temp-ok" ]; then
    echo "setup.sh: unknown option: $2" >&2
    exit 2
  fi
  temp_ok=yes
fi

case "$1" in
  /*) ;;
  *) echo "setup.sh: scratch dir must be absolute: $1" >&2; exit 2 ;;
esac
if [ ! -d "$1" ]; then
  echo "setup.sh: scratch dir does not exist: $1" >&2
  exit 2
fi
scratch=$(cd "$1" && pwd -P)
if [ "$scratch" = "/" ] || [ "$scratch" = "$(cd "$HOME" && pwd -P)" ]; then
  echo "setup.sh: refusing scratch dir $scratch" >&2
  exit 2
fi
case "$scratch" in
  /tmp/*|/private/tmp/*|/var/folders/*|/private/var/folders/*)
    if [ "$temp_ok" != yes ]; then
      echo "setup.sh: $scratch is under a temporary directory; see plan.md, \"Scratch location\"" >&2
      exit 2
    fi ;;
esac

home="$scratch/home"
owner="$scratch/owner"
remote="$scratch/remote.git"
state="$scratch/state"
worktree="$state/worktree"
outside="$scratch/outside"
www="$scratch/www"
out="$scratch/out"
settings="$scratch/claude-settings.json"
done_marker="$scratch/.l3-setup-done"
branch="foreman/l3"
empty_tree=4b825dc642cb6eb9a060e54bf8d69288fbe24904

# The clean git environment of src/runtime/git.ts (cleanGitEnvironment and
# cleanGitOverrides). Identity and the initial branch are -c overrides, so
# the environment keeps exactly the five variables.
cleangit() {
  env -i PATH=/usr/bin:/bin HOME="$home" GIT_CONFIG_NOSYSTEM=1 \
    GIT_CONFIG_GLOBAL=/dev/null GIT_ATTR_SOURCE="$empty_tree" \
    git -c core.hooksPath=/dev/null -c core.fsmonitor=false \
    -c commit.gpgsign=false -c user.name=foreman-l3 \
    -c user.email=foreman-l3@invalid -c init.defaultBranch=main "$@"
}

# Refuse a scratch dir inside a repository, before creating anything.
# GIT_DIR and friends are not set in the clean environment, so git
# searches upward from the directory. HOME is /var/empty here because
# "$home" may not exist yet.
if env -i PATH=/usr/bin:/bin HOME=/var/empty GIT_CONFIG_NOSYSTEM=1 \
  GIT_CONFIG_GLOBAL=/dev/null git -C "$scratch" rev-parse --git-dir >/dev/null 2>&1; then
  echo "setup.sh: $scratch is inside a git repository; refusing" >&2
  exit 2
fi
mkdir -p "$home"

if [ -f "$done_marker" ]; then
  echo "setup.sh: already set up in $scratch; nothing to do"
  exit 0
fi
for path in "$owner" "$remote" "$state" "$outside" "$www" "$settings"; do
  if [ -e "$path" ]; then
    echo "setup.sh: partial setup found ($path); run teardown.sh $scratch first" >&2
    exit 2
  fi
done
if [ -n "$(ls -A "$home")" ]; then
  echo "setup.sh: $home is not empty; run teardown.sh $scratch first" >&2
  exit 2
fi

mkdir -p "$outside" "$www" "$out" "$state"

# The remote a push would reach: a local bare repository, no network.
cleangit init --quiet --bare "$remote"

# The owner's checkout, with the protected files the plan probes.
cleangit init --quiet "$owner"
cat > "$owner/notes.txt" <<'EOF'
alpha
EOF
cat > "$owner/README.txt" <<'EOF'
Disposable repository for foreman's L3 subset live test.
EOF
cat > "$owner/AGENTS.md" <<'EOF'
# Disposable test repository

This repository exists only for a permission test. It has no build.
EOF
mkdir -p "$owner/.claude"
cat > "$owner/.claude/settings.json" <<'EOF'
{}
EOF
cat > "$owner/.gitattributes" <<'EOF'
*.txt text
EOF
cat > "$owner/check.sh" <<'EOF'
#!/bin/sh
# The target's test command (allowed in the editing profile). As committed
# it only probes the sandbox: the write below must be refused.
if ( : > ../../outside/check-probe ) 2>/dev/null; then
  echo "outside-write: LANDED"
else
  echo "outside-write: refused"
fi
echo "check: done"
EOF
cleangit -C "$owner" add notes.txt README.txt AGENTS.md .claude/settings.json .gitattributes check.sh
cleangit -C "$owner" commit --quiet -m "L3 subset: disposable repository"
cleangit -C "$owner" remote add origin "$remote"
cleangit -C "$owner" push --quiet origin main

# The supervisor worktree, created as the design's "Supervisor worktree"
# says: locked, on a new branch, at the owner's HEAD.
base=$(cleangit -C "$owner" rev-parse HEAD)
cleangit -C "$owner" worktree add --quiet --lock --reason foreman -b "$branch" "$worktree" "$base"
worktree=$(cd "$worktree" && pwd -P)

# Render the settings template for this worktree.
sed "s|@WORKTREE@|$worktree|g" "$template" > "$settings"
if grep -q '@WORKTREE@' "$settings"; then
  echo "setup.sh: template placeholder left in $settings" >&2
  exit 1
fi
/usr/bin/python3 -I -c 'import json,sys; json.load(open(sys.argv[1]))' "$settings"

git_dir=$(cleangit -C "$worktree" rev-parse --absolute-git-dir)
common_dir=$(cd "$worktree" && cd "$(cleangit rev-parse --git-common-dir)" && pwd -P)

cat > "$scratch/layout.env" <<EOF
L3_SCRATCH=$scratch
L3_OWNER=$owner
L3_REMOTE=$remote
L3_WORKTREE=$worktree
L3_GIT_DIR=$git_dir
L3_COMMON_DIR=$common_dir
L3_OUTSIDE=$outside
L3_WWW=$www
L3_OUT=$out
L3_SETTINGS=$settings
L3_BASE=$base
L3_BRANCH=$branch
EOF

: > "$done_marker"
echo "setup.sh: ready"
cat "$scratch/layout.env"
