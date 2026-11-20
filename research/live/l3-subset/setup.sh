#!/bin/bash
# L3 subset: create the disposable repository, its linked worktree and the
# rendered Claude settings under a new scratch root. Runs no agent client.
#
# Usage: setup.sh <scratch-root> [--temp-ok]
#
# <scratch-root> must be an absolute path that does not exist yet, in an
# existing parent directory that is not inside any git repository.
# setup.sh creates the root itself, so it never writes into a directory
# it did not create, and records in <scratch-root>/.l3-owner every
# top-level path before creating it (ownership.sh); teardown.sh removes
# only those. A root under a temporary directory is refused unless
# --temp-ok is given: Claude's Bash sandbox may allow writes under
# temporary directories, which would hide an outside write in the live
# run (plan.md, "Scratch location"). --temp-ok is for testing these
# scripts only.
#
# Not rerunnable: an existing root is refused, whatever it holds. After a
# failed setup, run teardown.sh on the root, then remove what it keeps.
set -eu

here=$(cd "$(dirname "$0")" && pwd -P)
template="$here/claude-settings.json"
. "$here/ownership.sh"

if [ $# -lt 1 ] || [ $# -gt 2 ]; then
  echo "usage: setup.sh <scratch-root> [--temp-ok]" >&2
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
  *) echo "setup.sh: scratch root must be absolute: $1" >&2; exit 2 ;;
esac
# Split the argument into its parent and the new name, ignoring trailing
# slashes; the parent must exist and is resolved, the name is created.
argument=$1
while [ "$argument" != "/" ] && [ "${argument%/}" != "$argument" ]; do
  argument=${argument%/}
done
name=${argument##*/}
parent=${argument%/*}
case "$name" in
  ""|.|..) echo "setup.sh: scratch root needs a new final name: $1" >&2; exit 2 ;;
esac
if ! l3_canonicalize "${parent:-/}"; then
  echo "setup.sh: parent of the scratch root does not exist: $1" >&2
  exit 2
fi
parent=$l3_canonical
case "$parent" in
  /) scratch="/$name" ;;
  *) scratch="$parent/$name" ;;
esac
l3_canonicalize "$HOME"
if [ "$scratch" = "$l3_canonical" ]; then
  echo "setup.sh: refusing \$HOME as the scratch root" >&2
  exit 2
fi
case "$scratch" in
  /tmp/*|/private/tmp/*|/var/folders/*|/private/var/folders/*)
    if [ "$temp_ok" != yes ]; then
      echo "setup.sh: the scratch root is under a temporary directory; see plan.md, \"Scratch location\"" >&2
      exit 2
    fi ;;
esac

# Refuse a root inside a repository, before creating anything. GIT_DIR
# and friends are not set in the clean environment, so git searches
# upward from the parent.
if env -i PATH=/usr/bin:/bin HOME=/var/empty GIT_CONFIG_NOSYSTEM=1 \
  GIT_CONFIG_GLOBAL=/dev/null git -C "$parent" rev-parse --git-dir >/dev/null 2>&1; then
  echo "setup.sh: the scratch root would be inside a git repository; refusing" >&2
  exit 2
fi

# Claim the root: mkdir fails if any file, directory or link is there.
if [ -e "$scratch" ] || [ -L "$scratch" ]; then
  echo "setup.sh: the scratch root already exists; choose a new path" >&2
  exit 2
fi
if ! mkdir -- "$scratch"; then
  echo "setup.sh: could not create the scratch root" >&2
  exit 2
fi
record="$scratch/$l3_record_name"
identity=$(l3_identity "$scratch")
( set -C
  printf '%s\nroot %s\nid %s\n' "$l3_record_header" "$(l3_hex "$scratch")" "$identity" > "$record" )

# Appends a top-level name to the record; called before creating it, so
# an interrupted setup never leaves an unrecorded path.
claim() {
  l3_is_owned_name "$1" || { echo "setup.sh: $1 is not an owned name" >&2; exit 1; }
  printf 'path %s\n' "$1" >> "$record"
}

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

for created in home outside www out state; do
  claim "$created"
  mkdir -- "$scratch/$created"
done

# The remote a push would reach: a local bare repository, no network.
claim remote.git
cleangit init --quiet --bare "$remote"

# The owner's checkout, with the protected files the plan probes.
claim owner
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
# says: locked, on a new branch, at the owner's HEAD. The root is already
# canonical, so the worktree path is too.
base=$(cleangit -C "$owner" rev-parse HEAD)
cleangit -C "$owner" worktree add --quiet --lock --reason foreman -b "$branch" "$worktree" "$base"

# Render the settings template for this worktree. The path goes in as a
# JSON string value, so json.dump escapes it; the template must use the
# placeholder at least once. Mode "x" refuses an existing output file.
claim claude-settings.json
/usr/bin/python3 -I - "$template" "$worktree" "$settings" <<'EOF'
import json
import sys

template, worktree, output = sys.argv[1:4]
placeholder = "@WORKTREE@"


def render(value):
    if isinstance(value, str):
        return value.replace(placeholder, worktree)
    if isinstance(value, list):
        return [render(item) for item in value]
    if isinstance(value, dict):
        return {key: render(item) for key, item in value.items()}
    return value


with open(template, encoding="utf-8") as source:
    data = json.load(source)
if placeholder not in json.dumps(data):
    sys.exit("setup.sh: the template has no " + placeholder)
with open(output, "x", encoding="utf-8") as target:
    json.dump(render(data), target, indent=2, ensure_ascii=False)
    target.write("\n")
EOF

git_dir=$(cleangit -C "$worktree" rev-parse --absolute-git-dir)
common_dir=$(cleangit -C "$worktree" rev-parse --path-format=absolute --git-common-dir)

# layout.env is sourced by a shell, so every value is single-quoted: a
# quote inside becomes '\'' and nothing else is special there, newlines
# included.
quote() {
  q="'"
  printf "'%s'" "${1//$q/$q\\$q$q}"
}
claim layout.env
{
  printf 'L3_SCRATCH=%s\n' "$(quote "$scratch")"
  printf 'L3_OWNER=%s\n' "$(quote "$owner")"
  printf 'L3_REMOTE=%s\n' "$(quote "$remote")"
  printf 'L3_WORKTREE=%s\n' "$(quote "$worktree")"
  printf 'L3_GIT_DIR=%s\n' "$(quote "$git_dir")"
  printf 'L3_COMMON_DIR=%s\n' "$(quote "$common_dir")"
  printf 'L3_OUTSIDE=%s\n' "$(quote "$outside")"
  printf 'L3_WWW=%s\n' "$(quote "$www")"
  printf 'L3_OUT=%s\n' "$(quote "$out")"
  printf 'L3_SETTINGS=%s\n' "$(quote "$settings")"
  printf 'L3_BASE=%s\n' "$(quote "$base")"
  printf 'L3_BRANCH=%s\n' "$(quote "$branch")"
} > "$scratch/layout.env"

claim .l3-setup-done
: > "$done_marker"
echo "setup.sh: ready"
cat "$scratch/layout.env"
