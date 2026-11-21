#!/bin/bash
# L3 subset: create the disposable repository, its linked worktree and the
# Claude settings production renders for it, under a new scratch root.
# Runs no agent client; it runs bun to read production's profile code
# (profile.sh).
#
# Usage: setup.sh <scratch-root> [--temp-ok]
#
# <scratch-root> must be an absolute path that does not exist yet, in an
# existing parent directory that is not inside any git repository. It
# and its resolved form may hold only letters, digits, ".", "_", "+",
# "-" and "/", the alphabet production's profile binds (see below).
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
. "$here/ownership.sh"
. "$here/profile.sh"

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

# The path alphabet of production's profile (src/format/claude-settings.ts,
# ProfilePathUnsafe): an absolute path of components made of letters,
# digits, ".", "_", "+" and "-", with no doubled or trailing slash. Any
# other character could read as syntax in a permission rule (a glob, a
# parenthesis, a space) or in a sandbox path, and JSON escaping does not
# neutralize it. The characters are listed, not given as ranges, and the
# C locale makes every byte one character.
LC_ALL=C
plain_path() {
  case "$1" in
    ""|[!/]*|*//*|*/) return 1 ;;
    *[!ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._+/-]*) return 1 ;;
  esac
}
refuse_unplain() {
  echo "setup.sh: $1 has a character outside letters, digits, . _ + - and /, or a doubled or trailing slash; production's profile would refuse it" >&2
  exit 2
}
# The argument as given, checked before anything else. Trailing slashes
# are dropped below, so only its characters count here.
case "$1" in
  *[!ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._+/-]*) refuse_unplain "the scratch root" ;;
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
# The resolved root and the worktree path the settings will bind: a link
# in the parent can bring in characters the argument did not have.
plain_path "$scratch" || refuse_unplain "the resolved scratch root"
plain_path "$scratch/state/worktree" || refuse_unplain "the worktree path"
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
# The project settings approve the fixture's MCP server, so that only the
# profile's own exclusion (--strict-mcp-config) keeps it from starting;
# whether project scope may approve its own servers is UNCONFIRMED (plan.md,
# "Project MCP fixture").
mkdir -p "$owner/.claude"
cat > "$owner/.claude/settings.json" <<'EOF'
{
  "enableAllProjectMcpServers": true,
  "enabledMcpjsonServers": ["l3-marker"]
}
EOF
# The project MCP server: if a client starts it, it appends one line to
# out/mcp-server.log and exits. It reads nothing and writes nothing else.
# The root's path is plain (checked above), so it needs no quoting in the
# shell command; the JSON encoder writes the file.
/usr/bin/python3 -I - "$out/mcp-server.log" "$owner/.mcp.json" <<'EOF'
import json
import sys

log, output = sys.argv[1:3]
server = {"type": "stdio", "command": "/bin/sh", "args": ["-c", "echo started >> " + log]}
with open(output, "x", encoding="utf-8") as target:
    json.dump({"mcpServers": {"l3-marker": server}}, target, indent=2)
    target.write("\n")
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
cleangit -C "$owner" add notes.txt README.txt AGENTS.md .claude/settings.json .gitattributes .mcp.json check.sh
cleangit -C "$owner" commit --quiet -m "L3 subset: disposable repository"
cleangit -C "$owner" remote add origin "$remote"
cleangit -C "$owner" push --quiet origin main

# The supervisor worktree, created as the design's "Supervisor worktree"
# says: locked, on a new branch, at the owner's HEAD. The root is already
# canonical, so the worktree path is too.
base=$(cleangit -C "$owner" rev-parse HEAD)
cleangit -C "$owner" worktree add --quiet --lock --reason foreman -b "$branch" "$worktree" "$base"

# Production's settings for this worktree, with the one stand-in plan.md
# lists (profile.sh). The file is created new; an existing one fails.
claim claude-settings.json
l3_production_settings "$worktree" "$settings"

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
