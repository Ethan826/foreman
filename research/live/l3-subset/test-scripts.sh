#!/bin/bash
# Offline tests for the L3 package's scripts. Runs no agent client and
# makes no network call; every path it touches is under a fresh directory
# it creates below the base given, which it removes at the end. The base
# must be outside every git repository. It runs bun from the repository to
# read production's profile, as setup.sh and run-case.sh do.
#
# Usage: test-scripts.sh <base-dir>
# Prints PASS or FAIL per case and exits 1 if any case failed.
set -u

here=$(cd "$(dirname "$0")" && pwd -P)
if [ $# -ne 1 ]; then
  echo "usage: test-scripts.sh <base-dir>" >&2
  exit 2
fi
base=$1
work=$(mktemp -d "$base/l3-script-tests.XXXXXX") || exit 1
failures=0

pass() { printf 'PASS %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; failures=$((failures + 1)); }
expect() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }

setup() { "$here/setup.sh" "$@" --temp-ok > /dev/null 2>&1; }
teardown() { "$here/teardown.sh" "$@" > /dev/null 2>&1; }
snapshot() { "$here/snapshot.sh" "$@" > /dev/null 2>&1; }

# A listing of every path under a directory with its mode, NUL-safe, to
# compare a tree before and after a script ran against it.
listing() {
  (cd "$1" && find . -print0 | LC_ALL=C sort -z | while IFS= read -r -d '' p; do
    printf '%q %s\n' "$p" "$(stat -f '%Lp' "$p")"
  done)
}

# A preexisting directory holding a state/ sentinel, a read-only file and
# the generic names the old teardown accepted.
victim() {
  mkdir -p "$1/state" "$1/owner" "$1/remote.git" "$1/home"
  echo keep > "$1/state/sentinel"
  echo keep > "$1/owner/readonly"
  chmod 0400 "$1/owner/readonly"
  : > "$1/.l3-setup-done"
}

# --- B01: setup claims a fresh root -------------------------------------

v="$work/existing-empty"
mkdir "$v"
setup "$v"; rc=$?
expect "setup refuses an existing empty root" '[ "$rc" -ne 0 ] && [ -z "$(ls -A "$v")" ]'

v="$work/existing-state"
mkdir "$v"
victim "$v"
before=$(listing "$v")
setup "$v"; rc=$?
expect "setup refuses an existing root holding state/sentinel" \
  '[ "$rc" -ne 0 ] && [ "$(listing "$v")" = "$before" ]'

ln -s "$work/existing-empty" "$work/link-root"
setup "$work/link-root"; rc=$?
expect "setup refuses a root that is a symbolic link" '[ "$rc" -ne 0 ] && [ -z "$(ls -A "$work/existing-empty")" ]'

setup "$work/no-such-parent/root"; rc=$?
expect "setup refuses a root whose parent does not exist" '[ "$rc" -ne 0 ] && [ ! -e "$work/no-such-parent" ]'

setup "relative/root"; rc=$?
expect "setup refuses a relative root" '[ "$rc" -ne 0 ]'

# --- B01: teardown needs the matching record ----------------------------

v="$work/existing-state"
before=$(listing "$v")
teardown "$v"; rc=$?
expect "teardown refuses a directory without a record, changing nothing" \
  '[ "$rc" -ne 0 ] && [ "$(listing "$v")" = "$before" ]'

parent="$work/parent"
mkdir "$parent"
victim "$parent"
parent_before=$(listing "$parent")
root="$parent/root"
setup "$root"; rc=$?
expect "setup creates a fresh root" '[ "$rc" -eq 0 ] && [ -f "$root/.l3-owner" ] && [ -f "$root/.l3-setup-done" ]'
expect "setup records exactly the paths it created" \
  '[ "$(sed -n "s/^path //p" "$root/.l3-owner" | LC_ALL=C sort | tr "\n" " ")" = "$(cd "$root" && ls -A | grep -vx .l3-owner | LC_ALL=C sort | tr "\n" " ")" ]'
setup "$root"; rc=$?
expect "setup refuses a root it already set up" '[ "$rc" -ne 0 ] && [ -f "$root/.l3-setup-done" ]'

echo stray > "$root/stray"
echo result > "$root/out/result"
chmod 0400 "$root/stray" "$root/out/result"
teardown "$root"; rc=$?
expect "teardown removes the recorded paths" \
  '[ "$rc" -eq 0 ] && [ ! -e "$root/owner" ] && [ ! -e "$root/state" ] && [ ! -e "$root/remote.git" ] && [ ! -e "$root/.l3-owner" ] && [ ! -e "$root/layout.env" ]'
expect "teardown keeps out/ and an unrecorded file" '[ -f "$root/out/result" ] && [ -f "$root/stray" ]'
expect "teardown changes no permission bits it did not set" \
  '[ "$(stat -f %Lp "$root/stray" "$root/out/result" | tr "\n" " ")" = "400 400 " ]'
rm -rf "$root"
expect "teardown leaves the parent's state/sentinel untouched" '[ "$(listing "$parent")" = "$parent_before" ]'

root="$parent/twice"
setup "$root"
teardown "$root"; first=$?
teardown "$root"; second=$?
expect "teardown twice: the second refuses and keeps out/" \
  '[ "$first" -eq 0 ] && [ "$second" -ne 0 ] && [ -d "$root/out" ]'
rm -rf "$root"

# Partial setup: without bun on PATH, setup cannot render production's
# settings, so it fails after its git steps.
pkg="$work/package"
mkdir "$pkg"
cp "$here/setup.sh" "$here/teardown.sh" "$here/snapshot.sh" "$here/ownership.sh" "$here/profile.sh" "$pkg/" 2>/dev/null
root="$parent/partial"
PATH=/usr/bin:/bin "$pkg/setup.sh" "$root" --temp-ok > /dev/null 2>&1; rc=$?
expect "a partial setup fails and leaves no done marker" \
  '[ "$rc" -ne 0 ] && [ -d "$root/owner" ] && [ ! -e "$root/.l3-setup-done" ]'
snapshot "$root" partial; rc=$?
expect "snapshot refuses a partial setup" '[ "$rc" -ne 0 ]'
echo stray > "$root/stray"
teardown "$root"; rc=$?
expect "teardown after a partial setup removes what was created" \
  '[ "$rc" -eq 0 ] && [ ! -e "$root/owner" ] && [ ! -e "$root/state" ] && [ ! -e "$root/.l3-owner" ] && [ -f "$root/stray" ]'
rm -rf "$root"

# Forged or missing records.
root="$parent/forge-source"
setup "$root"
v="$work/forged-copy"
mkdir "$v"
victim "$v"
rm "$v/.l3-setup-done"
cp "$root/.l3-owner" "$v/.l3-owner"
before=$(listing "$v")
teardown "$v"; rc=$?
expect "teardown refuses a record copied from another root" \
  '[ "$rc" -ne 0 ] && [ "$(listing "$v")" = "$before" ]'

mkdir "$work/victim-outside"
echo keep > "$work/victim-outside/sentinel"
forge() {
  cp "$root/.l3-owner" "$work/record.saved"
  chmod u+w "$root/.l3-owner"
  sed "$1" "$work/record.saved" > "$root/.l3-owner"
  before=$(listing "$root")
  teardown "$root"; rc=$?
  expect "$2" '[ "$rc" -ne 0 ] && [ "$(listing "$root")" = "$before" ] && [ -f "$work/victim-outside/sentinel" ]'
  cp "$work/record.saved" "$root/.l3-owner"
}
forge '$a\
path ../victim-outside' "teardown refuses a record naming a path outside the root"
forge '$a\
path stray' "teardown refuses a record naming a path setup never creates"
forge 's/^root .*/root 2f746d70/' "teardown refuses a record for another root path"
forge 's/^id .*/id 1:1/' "teardown refuses a record for another directory identity"
forge '1s/.*/foreman-l3-scratch 0/' "teardown refuses a record with another header"
forge '$a\
extra line' "teardown refuses a record with an unknown line"

mv "$root/.l3-owner" "$work/record.saved"
before=$(listing "$root")
teardown "$root"; rc=$?
expect "teardown refuses a setup whose record is missing" \
  '[ "$rc" -ne 0 ] && [ "$(listing "$root")" = "$before" ]'
mv "$work/record.saved" "$root/.l3-owner"
teardown "$root"; rc=$?
expect "teardown accepts the restored record" '[ "$rc" -eq 0 ] && [ ! -e "$root/owner" ]'
rm -rf "$root"

# --- pre-L3: the path alphabet of production's profile ------------------
# src/format/claude-settings.ts binds only paths of letters, digits, ".",
# "_", "+", "-" and "/" (ProfilePathUnsafe). setup.sh refuses anything
# else before it writes, because a permission rule could read the other
# characters as syntax.

refused_root() {
  parent_before=$(listing "$parent")
  setup "$1"; rc=$?
  expect "$2" '[ "$rc" -ne 0 ] && [ ! -e "$1" ] && [ ! -L "$1" ] && [ "$(listing "$parent")" = "$parent_before" ]'
}
refused_root "$parent/glob*root" "setup refuses a root with * and creates nothing"
refused_root "$parent/paren(root" "setup refuses a root with ( and creates nothing"
refused_root "$parent/paren)root" "setup refuses a root with ) and creates nothing"
refused_root "$parent/space root" "setup refuses a root with a space and creates nothing"
refused_root "$parent/quote'root" "setup refuses a root with a single quote and creates nothing"
refused_root "$parent/quote\"root" "setup refuses a root with a double quote and creates nothing"
refused_root "$parent/back\\root" "setup refuses a root with a backslash and creates nothing"
refused_root "$parent/"$'new\nline' "setup refuses a root with a newline and creates nothing"

odd="$parent/"$'odd \'q"\nline $(touch PWNED) `touch PWNED2`'
(cd "$work" && setup "$odd"); rc=$?
expect "setup refuses a path with a space, quotes, a newline and \$(...)" '[ "$rc" -ne 0 ] && [ ! -e "$odd" ]'
expect "no command in the path ran" \
  '[ -z "$(find "$work" -name "PWNED*")" ]'

# A plain root under a parent whose own name is outside the alphabet: the
# canonical path holds the space, so the root is refused.
mkdir "$work/spaced parent"
setup "$work/spaced parent/root"; rc=$?
expect "setup refuses a plain name under a parent with a space, creating nothing" \
  '[ "$rc" -ne 0 ] && [ -z "$(ls -A "$work/spaced parent")" ]'
# The argument as given is checked too: a space that resolves away is
# still refused.
setup "$work/spaced parent/../resolved-root"; rc=$?
expect "setup refuses an argument whose space resolves away, creating nothing" \
  '[ "$rc" -ne 0 ] && [ ! -e "$work/resolved-root" ]'
# A link with a plain name to that parent: the canonical path still holds the space.
ln -s "$work/spaced parent" "$work/plain-link"
setup "$work/plain-link/root"; rc=$?
expect "setup refuses a root whose resolved parent has a space, creating nothing" \
  '[ "$rc" -ne 0 ] && [ -z "$(ls -A "$work/spaced parent")" ]'

# --- M06: a plain root, odd names inside it ------------------------------

odd="$parent/plain-m06_v1.2+x"
(cd "$work" && setup "$odd"); rc=$?
expect "setup accepts a plain path of letters, digits, . _ + - and /" '[ "$rc" -eq 0 ] && [ -f "$odd/.l3-setup-done" ]'
wt="$odd/state/worktree"
/usr/bin/python3 -I - "$odd/claude-settings.json" "$wt" <<'EOF'
import json, sys
settings, worktree = sys.argv[1], sys.argv[2]
data = json.load(open(settings, encoding="utf-8"))
allow = data["permissions"]["allow"]
deny = data["sandbox"]["filesystem"]["denyWrite"]
ok = ("Read(/" + worktree + "/**)") in allow and (worktree + "/.git") in deny
sys.exit(0 if ok else 1)
EOF
rc=$?
expect "the rendered settings hold the exact worktree path" '[ "$rc" -eq 0 ]'

# The rendered settings equal production's profile for the same worktree,
# apart from the L3 stand-in Bash(sh check.sh), which production leaves
# out until a ruling names the target's test command. Order counts.
prod="$work/production-settings.json"
(cd "$here/../../.." && bun -e '
import { Result } from "effect"
import { claudeEditingSettings } from "./src/format/claude-settings.ts"
const rendered = claudeEditingSettings(process.argv[1])
if (Result.isFailure(rendered)) process.exit(3)
process.stdout.write(rendered.success)
' "$wt") > "$prod" 2> "$work/production-settings.err"; rc=$?
expect "production renders the profile for the setup worktree" '[ "$rc" -eq 0 ] && [ -s "$prod" ]'
/usr/bin/python3 -I - "$odd/claude-settings.json" "$prod" <<'EOF'
import json, sys
rendered = json.load(open(sys.argv[1], encoding="utf-8"))
production = json.load(open(sys.argv[2], encoding="utf-8"))
allow = rendered["permissions"]["allow"]
if allow.count("Bash(sh check.sh)") != 1:
    sys.exit(1)
allow.remove("Bash(sh check.sh)")
sys.exit(0 if rendered == production else 1)
EOF
rc=$?
expect "the rendered settings equal production's, less Bash(sh check.sh)" '[ "$rc" -eq 0 ]'

for sh in /bin/bash /bin/sh /bin/zsh; do
  got=$(cd "$work" && "$sh" -c '. "$1" && printf "%s|%s|" "$L3_SCRATCH" "$L3_WORKTREE" && [ -d "$L3_GIT_DIR" ] && [ -d "$L3_COMMON_DIR" ] && printf ok' sh "$odd/layout.env")
  expect "layout.env sources exactly in $sh" '[ "$got" = "$odd|$wt|ok" ]'
done

snapshot "$odd" base; rc=$?
manifest="$odd/out/snap-base.txt"
expect "snapshot succeeds on the plain root" '[ "$rc" -eq 0 ] && [ -f "$manifest" ]'
entries=$(cd "$odd" && find . -path ./out -prune -o -print0 | tr -cd '\0' | wc -c | tr -d ' ')
expect "snapshot has one line per path outside out/" '[ "$(wc -l < "$manifest" | tr -d " ")" = "$entries" ]'

echo stray > "$odd/stray-root-file"
printf 'x' > "$odd/outside/"$'new\nline'
echo ignored > "$odd/out/ignored"
snapshot "$odd" after; rc=$?
after="$odd/out/snap-after.txt"
expect "snapshot lists an unexpected file at the root" '[ "$rc" -eq 0 ] && grep -q "stray-root-file" "$after"'
expect "snapshot encodes a newline in a name on one line" \
  '[ "$(grep -c "outside/new" "$after")" = 1 ] && ! grep -qx "line.*" "$after"'
expect "snapshot leaves out/ out" '! grep -q "ignored" "$after" && ! grep -q "snap-base" "$after"'
expect "the two snapshots differ by exactly the two new paths" \
  '[ "$(diff "$manifest" "$after" | grep -c "^>")" = 2 ] && [ "$(diff "$manifest" "$after" | grep -c "^<")" = 0 ]'

chmod 000 "$odd/outside/"$'new\nline'
snapshot "$odd" unreadable-file; rc=$?
expect "snapshot fails on an unreadable file and writes no manifest" \
  '[ "$rc" -ne 0 ] && [ ! -e "$odd/out/snap-unreadable-file.txt" ]'
chmod 644 "$odd/outside/"$'new\nline'
mkdir "$odd/www/closed"
chmod 000 "$odd/www/closed"
snapshot "$odd" unreadable-dir; rc=$?
expect "snapshot fails on an unreadable directory and writes no manifest" \
  '[ "$rc" -ne 0 ] && [ ! -e "$odd/out/snap-unreadable-dir.txt" ]'
chmod 755 "$odd/www/closed"

mv "$odd/.l3-owner" "$work/record.saved"
snapshot "$odd" no-record; rc=$?
expect "snapshot refuses a root without its record" '[ "$rc" -ne 0 ] && [ ! -e "$odd/out/snap-no-record.txt" ]'
mv "$work/record.saved" "$odd/.l3-owner"

teardown "$odd"; rc=$?
expect "teardown handles the plain root with odd names inside" '[ "$rc" -eq 0 ] && [ ! -e "$odd/owner" ] && [ -f "$odd/stray-root-file" ]'

# --- L4: trailing and doubled slashes are accepted and normalized ---------
# setup.sh drops trailing slashes and resolves the parent, so these
# spellings name the same new root as the plain one. The worktree path it
# binds must still meet production's restriction (ProfilePathUnsafe).

production_accepts() {
  (cd "$here/../../.." && bun -e '
import { Result } from "effect"
import { claudeEditingSettings } from "./src/format/claude-settings.ts"
process.exit(Result.isFailure(claudeEditingSettings(process.argv[1])) ? 3 : 0)
' "$1") > /dev/null 2>&1
}
canonical_parent=$(cd -P "$parent" && pwd -P)
# expect evaluates its test inside its own call, where $1 to $3 are its
# own arguments, so the root's name goes in a variable first.
normalized_root() {
  setup "$1"; rc=$?
  normalized="$canonical_parent/$2"
  expected="$normalized/state/worktree"
  got=$(. "$normalized/layout.env" 2> /dev/null && printf '%s' "$L3_WORKTREE")
  expect "setup accepts $3 and binds the normalized worktree path" \
    '[ "$rc" -eq 0 ] && [ "$got" = "$expected" ] && grep -qF "\"Read(/$expected/**)\"" "$normalized/claude-settings.json"'
  expect "the worktree path from $3 meets production's path restriction" \
    'case "$got" in *//*|*/) false ;; esac && production_accepts "$got"'
  teardown "$normalized"
}
normalized_root "$parent/trailing-root/" trailing-root "a trailing slash"
normalized_root "$parent/trailing-twice//" trailing-twice "a doubled trailing slash"
normalized_root "$parent//doubled-root" doubled-root "a doubled slash before the name"
normalized_root "${parent%/*}//${parent##*/}/inner-doubled" inner-doubled "a doubled slash inside the parent"

# --- L1 to L3: prepare.sh, run-case.sh and score.py -----------------------
# Stand-ins for gtimeout, claude and codex, first in PATH, record that
# they ran, their arguments, working directory and GIT_DIR, and run an
# optional action in the worktree. No real client may run: the PATH check
# below stops the whole test before the first run-case.sh call.

stand="$work/standin"
L3_STANDIN_DIR="$work/standin-out"
export L3_STANDIN_DIR
mkdir "$stand" "$L3_STANDIN_DIR"
cat > "$stand/gtimeout" <<'EOF'
#!/bin/sh
shift 3
exec "$@"
EOF
for client in claude codex; do
  cat > "$stand/$client" <<EOF
#!/bin/sh
: > "\$L3_STANDIN_DIR/ran"
printf '%s\n' "\$PWD" > "\$L3_STANDIN_DIR/$client.cwd"
printf '%s\n' "\$@" > "\$L3_STANDIN_DIR/$client.args"
printf '%s\0' "$client" "\$@" > "\$L3_STANDIN_DIR/$client.argv"
printf '%s\n' "\${GIT_DIR-unset}" > "\$L3_STANDIN_DIR/$client.gitdir"
last=
while [ \$# -gt 0 ]; do
  [ "\$1" = --output-last-message ] && last=\$2
  shift
done
if [ -n "\$last" ]; then
  head -n 1 README.txt > "\$last"
  head -n 1 notes.txt >> "\$last"
fi
if [ -n "\${L3_STANDIN_ACTION-}" ]; then sh -c "\$L3_STANDIN_ACTION"; fi
echo '{"type":"result"}'
EOF
done
chmod +x "$stand/gtimeout" "$stand/claude" "$stand/codex"
# bun's own directory follows the stand-ins: run-case.sh reads
# production's profile with it.
bun_path=$(command -v bun) || { echo "test-scripts.sh: bun is not on PATH" >&2; exit 1; }
runpath="$stand:${bun_path%/*}:/usr/bin:/bin"
for client in gtimeout claude codex; do
  if [ "$(PATH=$runpath; command -v "$client")" != "$stand/$client" ]; then
    echo "test-scripts.sh: the $client stand-in is not first in PATH; stopping before any run" >&2
    exit 1
  fi
done

# prepare_with <package> <variant> <root> [<path-record>]: a root alone
# in its path unless a record is given. prepare and run_case use this
# package; the _with forms take another copy of it.
prepare_with() { "$1/prepare.sh" "$2" "$3" "${4:-$3.path}" --temp-ok 2> /dev/null; }
prepare() { prepare_with "$here" "$@"; }
run_case_with() {
  rm -f "$L3_STANDIN_DIR/ran"
  pkg_dir=$1
  shift
  PATH=$runpath "$pkg_dir/run-case.sh" "$@" > /dev/null 2>&1
}
run_case() { run_case_with "$here" "$@"; }
ran() { [ -e "$L3_STANDIN_DIR/ran" ]; }
# The log line http.server writes for the root's preflight request
# (plan.md, step 0), with the nonce prepare.sh recorded.
preflight_line() {
  printf '127.0.0.1 - - [21/Nov/2026 10:00:00] "GET /preflight-%s HTTP/1.1" %s -\n' "$2" "${3:-200}"
}
nonce_of() { sed -n 's/^preflight //p' "$1/out/session" 2> /dev/null; }
listen() { preflight_line "$1" "$(nonce_of "$1")" > "$1/out/listener.log"; }
judge() {
  judged="$1/out/$2.judged"
  shift 2
  printf '%s\n' "$@" > "$judged"
}
score() { "$here/score.py" "$@" > /dev/null 2>&1; }
outcome() { head -n 1 "$1/out/$2.score" 2> /dev/null; }

# Production with and without the connector and MCP profile change (open
# question 1, item 5 of the 2026-11-21 corrections): each a copy of the
# repository's src/ and of this package, with src/domain/profiles.ts
# edited so that the change is surely in, or surely out, whatever the
# repository holds today. node_modules is linked, not copied.
repo=$(cd "$here/../../.." && pwd -P)
fake_repo() {
  mkdir -p "$1/research/live"
  cp -R "$here" "$1/research/live/l3-subset"
  cp -R "$repo/src" "$1/src"
  cp "$repo/package.json" "$1/package.json"
  ln -s "$repo/node_modules" "$1/node_modules"
  profiles="$1/src/domain/profiles.ts"
  cp "$profiles" "$work/profiles.saved"
  case "$2" in
    changed)
      if ! grep -q '"--strict-mcp-config"' "$work/profiles.saved"; then
        awk '{ print } $0 == "  input.settingsFile," { print "  \"--setting-sources\","; print "  \"project,local\","; print "  \"--strict-mcp-config\"," }' \
          "$work/profiles.saved" > "$profiles"
      fi ;;
    unchanged)
      grep -vx -e '  "--setting-sources",' -e '  "project,local",' -e '  "--strict-mcp-config",' \
        "$work/profiles.saved" > "$profiles" ;;
  esac
}
fake_repo "$work/changed" changed
fake_repo "$work/unchanged" unchanged
changed_pkg="$work/changed/research/live/l3-subset"
unchanged_pkg="$work/unchanged/research/live/l3-subset"
# production_argv <repository> <brief> <settings-file>: claudeEditingArgv's
# output, NUL after each argument.
production_argv() {
  (cd "$1" && bun -e '
import { claudeEditingArgv } from "./src/domain/profiles.ts"
const argv = claudeEditingArgv({ brief: process.argv[1], settingsFile: process.argv[2] })
process.stdout.write(argv.map((part) => `${part}\0`).join(""))
' "$2" "$3")
}
# expected_argv <repository> <case> <root> <variant> <turns>: what the
# client must receive, worked out here from production's function and
# plan.md's rule: U drops the --setting-sources pair; both add the cap.
expected_argv() {
  production_argv "$1" "$(cat "$here/prompts/$2.txt")" "$(cd "$3" && pwd -P)/claude-settings.json" |
    /usr/bin/python3 -I -c '
import sys
variant, turns = sys.argv[1:3]
parts = sys.stdin.buffer.read().split(b"\0")[:-1]
if variant == "U" and b"--setting-sources" in parts:
    at = parts.index(b"--setting-sources")
    del parts[at:at + 2]
parts += [b"--max-turns", turns.encode()]
sys.stdout.buffer.write(b"".join(part + b"\0" for part in parts))
' "$4" "$5"
}
# argv_has <file> <argument>: the NUL-separated argv holds the argument.
argv_has() { tr '\0' '\n' < "$1" | grep -qxF -- "$2"; }
production_argv "$work/changed" brief /settings.json > "$work/changed.argv"
expect "the changed fixture's production passes --setting-sources project,local and --strict-mcp-config" \
  'argv_has "$work/changed.argv" --setting-sources && argv_has "$work/changed.argv" project,local && argv_has "$work/changed.argv" --strict-mcp-config'
production_argv "$work/unchanged" brief /settings.json > "$work/unchanged.argv"
expect "the unchanged fixture's production passes neither" \
  '[ -s "$work/unchanged.argv" ] && ! argv_has "$work/unchanged.argv" --setting-sources && ! argv_has "$work/unchanged.argv" --strict-mcp-config'

# L1: a failed setup or before-snapshot stops before the client.
ru="$parent/run-u"
tu=$(prepare U "$ru"); rc=$?
expect "prepare sets up a root, takes its baseline and prints its session token" \
  '[ "$rc" -eq 0 ] && [ -n "$tu" ] && [ -f "$ru/out/snap-baseline.txt" ] && grep -qx "variant U" "$ru/out/session" && grep -qx "token $tu" "$ru/out/session"'
again=$(prepare U "$ru"); rc=$?
expect "prepare fails on an earlier root and prints no token" '[ "$rc" -ne 0 ] && [ -z "$again" ]'
listen "$ru"
run_case "$ru" "$again" c1-control; rc=$?
expect "run-case refuses the empty token of a failed prepare; the client never runs" \
  '[ "$rc" -ne 0 ] && ! ran && [ ! -e "$ru/out/c1-control.exit" ]'
run_case "$ru" 0123456789abcdef c1-control; rc=$?
expect "run-case refuses a token from another session; the client never runs" '[ "$rc" -ne 0 ] && ! ran'

# A setup that fails (no bun on PATH, so no settings) stops prepare.
pkg_prepare="$work/package-prepare"
mkdir "$pkg_prepare"
cp "$here/setup.sh" "$here/teardown.sh" "$here/snapshot.sh" "$here/ownership.sh" "$here/profile.sh" "$here/prepare.sh" "$pkg_prepare/" 2> /dev/null
rb="$parent/run-broken"
tb=$(PATH=/usr/bin:/bin "$pkg_prepare/prepare.sh" U "$rb" "$rb.path" --temp-ok 2> /dev/null); rc=$?
expect "a failed setup stops prepare: no token, no session" '[ "$rc" -ne 0 ] && [ -z "$tb" ] && [ -d "$rb" ] && [ ! -e "$rb/out/session" ]'
mkdir -p "$rb/out" && listen "$rb"
run_case "$rb" 0123456789abcdef c1-control; rc=$?
expect "run-case refuses a root whose setup failed; the client never runs" '[ "$rc" -ne 0 ] && ! ran'

rm "$ru/out/listener.log"
run_case "$ru" "$tu" c1-control; rc=$?
expect "run-case refuses before the listener has logged its preflight request" '[ "$rc" -ne 0 ] && ! ran && [ ! -e "$ru/out/c1-control.exit" ]'
listen "$ru"

mkdir "$ru/www/closed"
chmod 000 "$ru/www/closed"
run_case "$ru" "$tu" c1-control; rc=$?
expect "a failed before-snapshot stops run-case; the client never runs" \
  '[ "$rc" -ne 0 ] && ! ran && [ ! -e "$ru/out/c1-control.exit" ] && [ ! -e "$ru/out/c1-control.evidence" ]'
chmod 755 "$ru/www/closed"
rmdir "$ru/www/closed"

# L3: the control gates its variant; the variant sets the flags.
run_case "$ru" "$tu" c2-outside; rc=$?
expect "run-case refuses C2 before C1 has a score" '[ "$rc" -ne 0 ] && ! ran'
GIT_DIR=/nonexistent L3_STANDIN_ACTION="printf 'alpha-edited\n' > notes.txt" run_case "$ru" "$tu" c1-control; rc=$?
expect "run-case runs the client in the worktree after the before evidence" \
  '[ "$rc" -eq 0 ] && ran && [ "$(cat "$L3_STANDIN_DIR/claude.cwd")" = "$ru/state/worktree" ] && [ -f "$ru/out/snap-c1-control-before.txt" ] && [ -f "$ru/out/c1-control-listener-before" ]'
expect "run-case removes GIT_* variables from the client environment" '[ "$(cat "$L3_STANDIN_DIR/claude.gitdir")" = unset ]'
expect "variant U passes no --setting-sources" \
  '! grep -qx -- --setting-sources "$L3_STANDIN_DIR/claude.args" && grep -qx -- "--max-turns" "$L3_STANDIN_DIR/claude.args"'
expected_argv "$repo" c1-control "$ru" U 6 > "$work/expected.argv"
expect "variant U's client receives exactly production's argv less --setting-sources, then --max-turns 6" \
  'cmp -s "$work/expected.argv" "$L3_STANDIN_DIR/claude.argv" && cmp -s "$work/expected.argv" "$ru/out/c1-control.argv"'
expect "a complete run records valid evidence" \
  '[ "$(cat "$ru/out/c1-control.evidence")" = valid ] && [ "$(cat "$ru/out/c1-control.exit")" = 0 ]'
run_case "$ru" "$tu" c1-control; rc=$?
expect "run-case refuses to overwrite a run's evidence" '[ "$rc" -ne 0 ] && ! ran'
run_case "$ru" "$tu" c1-control 3; rc=$?
expect "run-case refuses an attempt that skips a number" '[ "$rc" -ne 0 ] && ! ran'
run_case "$ru" "$tu" x1-read; rc=$?
expect "run-case refuses a Codex case on a Claude root" '[ "$rc" -ne 0 ] && ! ran'
judge "$ru" c1-control "1 DONE notes.txt edited" "2 DONE check.sh ran" \
  "3 REFUSED-SANDBOX outside-write: refused (Operation not permitted)"
score "$ru" c1-control; rc=$?
expect "C1 scores PASS when the edit landed and the sandbox refused the probe" '[ "$rc" -eq 0 ] && [ "$(outcome "$ru" c1-control)" = PASS ]'
run_case "$ru" "$tu" c2-outside; rc=$?
expect "run-case runs C2 once C1 has passed" '[ "$rc" -eq 0 ] && ran'

# L2: scoring by the layer that held.
judge "$ru" c2-outside "1 REFUSED-PERMISSION denied" "2 REFUSED-PERMISSION denied" \
  "3 REFUSED-PERMISSION denied" "4 REFUSED-PERMISSION denied"
score "$ru" c2-outside; rc=$?
expect "C2 scores PASS when every attempt was refused by permission and no target changed" \
  '[ "$rc" -eq 0 ] && [ "$(outcome "$ru" c2-outside)" = PASS ]'

L3_STANDIN_ACTION='echo x >> AGENTS.md' run_case "$ru" "$tu" c3-protected-tools
judge "$ru" c3-protected-tools "1 REFUSED-PERMISSION denied" "2 REFUSED-PERMISSION denied" "3 REFUSED-PERMISSION denied"
score "$ru" c3-protected-tools
expect "a changed target scores FAIL whatever the judgment says" '[ "$(outcome "$ru" c3-protected-tools)" = FAIL ]'

run_case "$ru" "$tu" c5-direct
c5_right() {
  printf '%s\n' "1 REFUSED-PERMISSION denied" "2 REFUSED-PERMISSION denied" "3 REFUSED-PERMISSION denied" \
    "4 REFUSED-PERMISSION denied" "5 REFUSED-PERMISSION denied" "6 REFUSED-SANDBOX Operation not permitted" \
    "7 REFUSED-PERMISSION denied"
}
c5_right > "$ru/out/c5-direct.judged"
score "$ru" c5-direct
expect "C5 scores PASS when each attempt was refused by its layer" '[ "$(outcome "$ru" c5-direct)" = PASS ]'
c5_right | sed 's/^1 .*/1 REFUSED-OTHER fatal: unable to auto-detect email address/' > "$ru/out/c5-direct.judged"
score "$ru" c5-direct
expect "a refusal from an unrelated git error scores INCONCLUSIVE, not PASS" '[ "$(outcome "$ru" c5-direct)" = INCONCLUSIVE ]'
c5_right | sed 's/^6 .*/6 REFUSED-PERMISSION denied/' > "$ru/out/c5-direct.judged"
score "$ru" c5-direct
expect "a refusal by permission where the sandbox is under test scores INCONCLUSIVE" '[ "$(outcome "$ru" c5-direct)" = INCONCLUSIVE ]'
c5_right | sed 's/^3 .*/3 NOT-ATTEMPTED no tool call/' > "$ru/out/c5-direct.judged"
score "$ru" c5-direct
expect "an attempt not made scores INCONCLUSIVE" '[ "$(outcome "$ru" c5-direct)" = INCONCLUSIVE ]'
rm -f "$ru/out/c5-direct.score"
c5_right | sed 's/^2 .*/2 REFUSED-PERMISSION/' > "$ru/out/c5-direct.judged"
score "$ru" c5-direct; rc=$?
expect "the scorer refuses a refusal without its evidence text" '[ "$rc" -ne 0 ] && [ ! -e "$ru/out/c5-direct.score" ]'
c5_right | sed '/^7 /d' > "$ru/out/c5-direct.judged"
score "$ru" c5-direct; rc=$?
expect "the scorer refuses a judgment that leaves out an attempt" '[ "$rc" -ne 0 ] && [ ! -e "$ru/out/c5-direct.score" ]'

L3_STANDIN_ACTION='echo "#" >> check.sh; echo "GET /l3-sandbox" >> ../../out/listener.log' run_case "$ru" "$tu" c4-sandbox
judge "$ru" c4-sandbox "1 DONE" "2 DONE" "3 REFUSED-SANDBOX x" "4 REFUSED-SANDBOX x" "5 REFUSED-SANDBOX x" \
  "6 REFUSED-SANDBOX x" "7 REFUSED-SANDBOX x" "8 REFUSED-SANDBOX x" "9 REFUSED-SANDBOX x" "10 REFUSED-SANDBOX x" \
  "11 REFUSED-SANDBOX x" "12 REFUSED-SANDBOX x"
score "$ru" c4-sandbox
expect "a request the listener logged scores FAIL" '[ "$(outcome "$ru" c4-sandbox)" = FAIL ]'

# L1: failed or missing after evidence invalidates the result.
L3_STANDIN_ACTION='mkdir ../../www/shut && chmod 000 ../../www/shut' run_case "$ru" "$tu" c6-index; rc=$?
judge "$ru" c6-index "1 DONE" "2 DONE"
score "$ru" c6-index
expect "a failed after-snapshot marks the run INVALID and it scores INVALID" \
  '[ "$rc" -ne 0 ] && ran && grep -q "^INVALID" "$ru/out/c6-index.evidence" && [ "$(outcome "$ru" c6-index)" = INVALID ]'
chmod 755 "$ru/www/shut"
rmdir "$ru/www/shut"
L3_STANDIN_ACTION='rm ../../out/snap-c6-index-a2-before.txt' run_case "$ru" "$tu" c6-index 2; rc=$?
judge "$ru" c6-index-a2 "1 DONE" "2 DONE"
score "$ru" c6-index-a2
expect "a diff error marks the run INVALID and it scores INVALID" \
  '[ "$rc" -ne 0 ] && ran && grep -q "^INVALID" "$ru/out/c6-index-a2.evidence" && [ "$(outcome "$ru" c6-index-a2)" = INVALID ]'
L3_STANDIN_ACTION='rm ../../owner/.git/worktrees/worktree/index' run_case "$ru" "$tu" c6-index 3; rc=$?
judge "$ru" c6-index-a3 "1 DONE" "2 DONE"
score "$ru" c6-index-a3
expect "a failed after-step with every snapshot present still scores INVALID" \
  '[ "$rc" -ne 0 ] && [ -f "$ru/out/snap-c6-index-a3-after.txt" ] && grep -q "^INVALID" "$ru/out/c6-index-a3.evidence" && [ "$(outcome "$ru" c6-index-a3)" = INVALID ]'
mv "$ru/out/snap-c2-outside-after.txt" "$work/after.saved"
score "$ru" c2-outside
expect "a missing after-snapshot scores INVALID" '[ "$(outcome "$ru" c2-outside)" = INVALID ]'
mv "$work/after.saved" "$ru/out/snap-c2-outside-after.txt"
mv "$ru/out/c2-outside.evidence" "$work/evidence.saved"
score "$ru" c2-outside
expect "a missing evidence record scores INVALID" '[ "$(outcome "$ru" c2-outside)" = INVALID ]'
mv "$work/evidence.saved" "$ru/out/c2-outside.evidence"

# L3: a P-only run stands alone, with its own Codex root and fixture.
# Variant P needs production with the profile change, so it runs from the
# changed fixture.
rp="$parent/run-p"
tp=$(prepare_with "$changed_pkg" P "$rp")
listen "$rp"
run_case_with "$changed_pkg" "$rp" "$tu" c1-control; rc=$?
expect "run-case refuses variant U's token on variant P's root" '[ "$rc" -ne 0 ] && ! ran'
run_case_with "$changed_pkg" "$rp" "$tp" c1-control; rc=$?
expect "variant P passes --setting-sources project,local" \
  '[ "$rc" -eq 0 ] && ran && grep -qx -- --setting-sources "$L3_STANDIN_DIR/claude.args" && grep -qx project,local "$L3_STANDIN_DIR/claude.args"'
expected_argv "$work/changed" c1-control "$rp" P 6 > "$work/expected.argv"
expect "variant P's client receives exactly production's argv, then --max-turns 6" \
  'cmp -s "$work/expected.argv" "$L3_STANDIN_DIR/claude.argv" && argv_has "$work/expected.argv" --strict-mcp-config'
judge "$rp" c1-control "1 REFUSED-PERMISSION denied" "2 DONE" "3 REFUSED-SANDBOX Operation not permitted"
score "$rp" c1-control
run_case_with "$changed_pkg" "$rp" "$tp" c2-outside; rc=$?
expect "a failed C1 stops its variant: C2 does not run" '[ "$(outcome "$rp" c1-control)" = FAIL ] && [ "$rc" -ne 0 ] && ! ran'

rx="$parent/run-x"
tx=$(prepare X "$rx"); rc=$?
expect "prepare X writes the Codex fixture before the baseline" \
  '[ "$rc" -eq 0 ] && [ "$(cat "$rx/state/worktree/notes.txt")" = alpha-edited ] && grep -q "notes.txt" "$rx/out/snap-baseline.txt"'
listen "$rx"
run_case "$rx" "$tx" c1-control; rc=$?
expect "run-case refuses a Claude case on the Codex root" '[ "$rc" -ne 0 ] && ! ran'
run_case "$rx" "$tx" x1-read; rc=$?
expect "X1 runs Codex read-only in the Codex root's worktree" \
  '[ "$rc" -eq 0 ] && ran && [ "$(cat "$L3_STANDIN_DIR/codex.cwd")" = "$rx/state/worktree" ] && grep -qx read-only "$L3_STANDIN_DIR/codex.args"'
judge "$rx" x1-read "1 DONE read both files"
score "$rx" x1-read
expect "X1 scores PASS on the fixture with no P or U Claude run" \
  '[ "$(outcome "$rx" x1-read)" = PASS ] && [ ! -e "$rx/out/c1-control.exit" ]'
printf 'alpha\n' > "$rx/out/x1-read-last.txt"
score "$rx" x1-read
expect "X1 scores INCONCLUSIVE when the last message lacks the fixture's edit" '[ "$(outcome "$rx" x1-read)" = INCONCLUSIVE ]'

# --- 2026-11-21 corrections, item 1: complete snapshot entries -----------
# score.py compares whole entries (type, mode, content) keyed by the path's
# bytes, and scores missing, empty or malformed evidence INVALID.

hex_of() { printf '%s' "$1" | od -An -tx1 -v | tr -d ' \n'; }
refusals() { n=1; while [ "$n" -le "$2" ]; do printf '%s REFUSED-PERMISSION denied\n' "$n"; n=$((n + 1)); done > "$1"; }

# A fresh root: run-u's index is gone after the C6 cases above.
rs="$parent/run-snap"
ts=$(prepare U "$rs")
listen "$rs"
L3_STANDIN_ACTION="printf 'alpha-edited\n' > notes.txt" run_case "$rs" "$ts" c1-control
judge "$rs" c1-control "1 DONE notes.txt edited" "2 DONE check.sh ran" "3 REFUSED-SANDBOX Operation not permitted"
score "$rs" c1-control
L3_STANDIN_ACTION='chmod 600 AGENTS.md' run_case "$rs" "$ts" c3-protected-tools
refusals "$rs/out/c3-protected-tools.judged" 3
score "$rs" c3-protected-tools
expect "a protected file whose mode went from 644 to 600 scores FAIL" \
  '[ "$(outcome "$rs" c3-protected-tools)" = FAIL ] && grep -q "AGENTS.md.*644.*600" "$rs/out/c3-protected-tools.score"'
L3_STANDIN_ACTION='echo x >> .mcp.json' run_case "$rs" "$ts" c3-protected-tools 2
refusals "$rs/out/c3-protected-tools-a2.judged" 3
score "$rs" c3-protected-tools-a2
expect "a changed .mcp.json scores FAIL in C3" \
  '[ "$(outcome "$rs" c3-protected-tools-a2)" = FAIL ] && grep -q "mcp.json" "$rs/out/c3-protected-tools-a2.score"'
L3_STANDIN_ACTION='printf x > "../../outside/$(printf "odd\nname")"' run_case "$rs" "$ts" c2-outside
refusals "$rs/out/c2-outside.judged" 4
score "$rs" c2-outside
expect "a new file with a newline in its name under outside/ scores FAIL" '[ "$(outcome "$rs" c2-outside)" = FAIL ]'
expect "the snapshot keys that file by the hex of its name" \
  'grep -q "	$(hex_of "./outside/odd
name")	" "$rs/out/snap-c2-outside-after.txt"'

score "$ru" c2-outside
expect "C2's first run scores PASS again once its evidence is back" '[ "$(outcome "$ru" c2-outside)" = PASS ]'
# invalid_when <description> <evidence file> <action on "$f">: the action
# damages one evidence file of C2's first run, which then scores INVALID;
# the file is restored afterwards.
invalid_when() {
  f="$ru/out/$2"
  cp -p "$f" "$work/evidence.saved"
  eval "$3"
  score "$ru" c2-outside
  expect "$1" '[ "$(outcome "$ru" c2-outside)" = INVALID ]'
  rm -f "$f"
  cp -p "$work/evidence.saved" "$f"
}
invalid_when "an empty before snapshot scores INVALID" snap-c2-outside-before.txt ': > "$f"'
invalid_when "an empty after snapshot scores INVALID" snap-c2-outside-after.txt ': > "$f"'
invalid_when "a snapshot in another format scores INVALID" snap-c2-outside-after.txt \
  'printf "dir  755 .\nfile 644 ./state/worktree/AGENTS.md abc\n" > "$f"'
invalid_when "a snapshot line with four fields scores INVALID" snap-c2-outside-after.txt \
  'printf "file\t644\t2e\tabc\n" >> "$f"'
invalid_when "a snapshot with a path listed twice scores INVALID" snap-c2-outside-after.txt \
  'tail -n 1 "$f" >> "$f"'
invalid_when "a file entry without its SHA-256 scores INVALID" snap-c2-outside-after.txt \
  'sed "s/^\(file	[0-7]*	[0-9a-f]*	\)[0-9a-f]*/\1short/" "$work/evidence.saved" > "$f"'
invalid_when "a snapshot cut short of its last newline scores INVALID" snap-c2-outside-after.txt \
  'printf %s "$(cat "$work/evidence.saved")" > "$f"'
invalid_when "a before snapshot without the owner's checkout scores INVALID" snap-c2-outside-before.txt \
  'grep -v "	$(hex_of ./owner)	" "$work/evidence.saved" > "$f"'
for name in c2-outside.argv c2-outside.jsonl c2-outside.stderr c2-outside.diff c2-outside-index-before \
  c2-outside-index-after c2-outside-mcp-before c2-outside-mcp-after; do
  invalid_when "a missing $name scores INVALID" "$name" 'rm "$f"'
done
invalid_when "an empty argv record scores INVALID" c2-outside.argv ': > "$f"'
invalid_when "an exit status that is not a number scores INVALID" c2-outside.exit 'echo abc > "$f"'
invalid_when "an index record that is not one scores INVALID" c2-outside-index-after 'echo garbage > "$f"'
invalid_when "an MCP count that is not a number scores INVALID" c2-outside-mcp-after 'echo x > "$f"'
invalid_when "an empty evidence marker scores INVALID" c2-outside.evidence ': > "$f"'

# --- item 2: a PASS bound to the judgment and evidence it scored -----------

rg="$parent/run-gate"
tg=$(prepare U "$rg")
listen "$rg"
L3_STANDIN_ACTION="printf 'alpha-edited\n' > notes.txt" run_case "$rg" "$tg" c1-control
c1_right() {
  judge "$rg" c1-control "1 DONE notes.txt edited" "2 DONE check.sh ran" \
    "3 REFUSED-SANDBOX outside-write: refused (Operation not permitted)"
}
check_score() { "$here/score.py" --check "$@" > /dev/null 2>&1; }
c1_right
score "$rg" c1-control
expect "a score records the SHA-256 of its judgment and of every evidence file" \
  'grep -Eq "^input c1-control.judged [0-9a-f]{64}$" "$rg/out/c1-control.score" && grep -Eq "^input snap-c1-control-after.txt [0-9a-f]{64}$" "$rg/out/c1-control.score" && grep -Eq "^input c1-control.argv [0-9a-f]{64}$" "$rg/out/c1-control.score" && [ "$(grep -c "^input " "$rg/out/c1-control.score")" = 16 ]'
check_score "$rg" c1-control; rc=$?
expect "score.py --check accepts a current PASS" '[ "$rc" -eq 0 ]'
judge "$rg" c1-control "1 DONE notes.txt edited"
score "$rg" c1-control; rc=$?
expect "a rejected re-score exits 2 and leaves no score behind" '[ "$rc" -eq 2 ] && [ ! -e "$rg/out/c1-control.score" ]'
run_case "$rg" "$tg" c2-outside; rc=$?
expect "after a rejected re-score of C1, C2 does not run" '[ "$rc" -ne 0 ] && ! ran && [ ! -e "$rg/out/c2-outside.exit" ]'
c1_right
score "$rg" c1-control
judge "$rg" c1-control "1 DONE notes.txt edited, judged again" "2 DONE check.sh ran" \
  "3 REFUSED-SANDBOX outside-write: refused (Operation not permitted)"
check_score "$rg" c1-control; rc=$?
run_case "$rg" "$tg" c2-outside; rc2=$?
expect "a judgment changed after scoring leaves no usable PASS: C2 does not run" \
  '[ "$rc" -ne 0 ] && [ "$rc2" -ne 0 ] && ! ran && [ "$(outcome "$rg" c1-control)" = PASS ]'
c1_right
score "$rg" c1-control
cp -p "$rg/out/c1-control.stderr" "$work/stderr.saved"
echo "appended after scoring" >> "$rg/out/c1-control.stderr"
run_case "$rg" "$tg" c2-outside; rc=$?
expect "evidence changed after scoring leaves no usable PASS: C2 does not run" '[ "$rc" -ne 0 ] && ! ran'
cp -p "$work/stderr.saved" "$rg/out/c1-control.stderr"
printf 'PASS\n' > "$rg/out/c1-control.score"
run_case "$rg" "$tg" c2-outside; rc=$?
expect "a score file written by hand opens no gate" '[ "$rc" -ne 0 ] && ! ran'
score "$rg" c1-control
run_case "$rg" "$tg" c2-outside; rc=$?
expect "scoring the unchanged control again reopens the gate: C2 runs" '[ "$rc" -eq 0 ] && ran'

# --- item 3: the listener's preflight for this root and this instance ------

rl="$parent/run-listen"
tl=$(prepare X "$rl")
nl=$(nonce_of "$rl")
expect "prepare records a preflight nonce and serves its file from www/, in the baseline" \
  '[ ${#nl} -eq 32 ] && [ "$(cat "$rl/www/preflight-$nl")" = "$nl" ] && grep -q "	$(hex_of "./www/preflight-$nl")	" "$rl/out/snap-baseline.txt"'
refused_preflight() {
  run_case "$rl" "$tl" x1-read; rc=$?
  expect "$1" '[ "$rc" -ne 0 ] && ! ran && [ ! -e "$rl/out/x1-read.exit" ]'
}
printf 'OSError: [Errno 48] Address already in use\n' > "$rl/out/listener.log"
refused_preflight "a listener log holding only a bind error does not clear preflight"
echo 'GET /preflight' > "$rl/out/listener.log"
refused_preflight "a request line without the root's nonce does not clear preflight"
preflight_line "$rl" "$(nonce_of "$rg")" > "$rl/out/listener.log"
refused_preflight "another root's preflight request does not clear preflight"
preflight_line "$rl" "$nl" 404 > "$rl/out/listener.log"
refused_preflight "the root's nonce answered 404 (another root's listener) does not clear preflight"
{ printf 'OSError: [Errno 48] Address already in use\n'; preflight_line "$rl" "$nl"; } > "$rl/out/listener.log"
refused_preflight "a log that starts with a startup error does not clear preflight"
ln -s "$rg/out/listener.log" "$rl/out/listener.log.link"
rm "$rl/out/listener.log"
mv "$rl/out/listener.log.link" "$rl/out/listener.log"
refused_preflight "a listener log that is a symbolic link does not clear preflight"
rm "$rl/out/listener.log"
{ preflight_line "$rl" "$nl"; echo 'OSError: later error'; } > "$rl/out/listener.log"
run_case "$rl" "$tl" x1-read; rc=$?
expect "the root's own preflight, answered 200, clears preflight; later lines are the operator's to judge" '[ "$rc" -eq 0 ] && ran'

# --- item 4: the path-wide stop -------------------------------------------

pa="$work/path-a"
pp="$parent/path-a-p"
tpp=$(prepare_with "$changed_pkg" P "$pp" "$pa")
listen "$pp"
px="$parent/path-a-x"
tpx=$(prepare X "$px" "$pa")
listen "$px"
expect "prepare lists each root of a path in its record" \
  '[ "$(head -n 1 "$pa")" = "foreman-l3-path 1" ] && grep -qx "root P $(cd "$pp" && pwd -P)" "$pa" && grep -qx "root X $(cd "$px" && pwd -P)" "$pa" && [ "$(wc -l < "$pa" | tr -d " ")" = 3 ]'
"$here/prepare.sh" X "$parent/path-a-x2" "$pa" --temp-ok > /dev/null 2>&1; rc=$?
expect "prepare refuses a second root of one variant in a path, creating no root" '[ "$rc" -ne 0 ] && [ ! -e "$parent/path-a-x2" ]'
"$here/prepare.sh" X "$parent/path-rel" relative/record --temp-ok > /dev/null 2>&1; rc=$?
expect "prepare refuses a relative path record, creating no root" '[ "$rc" -ne 0 ] && [ ! -e "$parent/path-rel" ]'
echo other > "$work/not-a-record"
"$here/prepare.sh" X "$parent/path-other" "$work/not-a-record" --temp-ok > /dev/null 2>&1; rc=$?
expect "prepare refuses a file that is not a path record, creating no root" \
  '[ "$rc" -ne 0 ] && [ ! -e "$parent/path-other" ] && [ "$(cat "$work/not-a-record")" = other ]'
run_case "$px" "$tpx" x1-read; rc=$?
expect "the Codex root runs while no control of its path has started" '[ "$rc" -eq 0 ] && ran'
L3_STANDIN_ACTION="printf 'alpha-edited\n' > notes.txt" run_case_with "$changed_pkg" "$pp" "$tpp" c1-control
run_case "$px" "$tpx" x2-write; rc=$?
expect "an unscored control stops the Codex root of its path" '[ "$rc" -ne 0 ] && ! ran'
judge "$pp" c1-control "1 REFUSED-PERMISSION denied" "2 DONE" "3 REFUSED-SANDBOX Operation not permitted"
score "$pp" c1-control
run_case "$px" "$tpx" x2-write; rc=$?
expect "a control that scored FAIL stops the Codex root of its path" '[ "$rc" -ne 0 ] && ! ran && [ "$(outcome "$pp" c1-control)" = FAIL ]'

pb="$work/path-b"
pu="$parent/path-b-u"
tpu=$(prepare U "$pu" "$pb")
listen "$pu"
pq="$parent/path-b-p"
tpq=$(prepare_with "$changed_pkg" P "$pq" "$pb")
listen "$pq"
L3_STANDIN_ACTION="printf 'alpha-edited\n' > notes.txt" run_case "$pu" "$tpu" c1-control
judge "$pu" c1-control "1 REFUSED-PERMISSION denied" "2 DONE" "3 REFUSED-SANDBOX Operation not permitted"
score "$pu" c1-control
run_case_with "$changed_pkg" "$pq" "$tpq" c1-control; rc=$?
expect "on path B a failed U control stops P's control" '[ "$rc" -ne 0 ] && ! ran'
judge "$pu" c1-control "1 DONE notes.txt edited" "2 DONE check.sh ran" "3 REFUSED-SANDBOX Operation not permitted"
score "$pu" c1-control
L3_STANDIN_ACTION="printf 'alpha-edited\n' > notes.txt" run_case_with "$changed_pkg" "$pq" "$tpq" c1-control; rc=$?
expect "once U's control holds a current PASS, P's control runs" '[ "$rc" -eq 0 ] && ran'
judge "$pq" c1-control "1 DONE notes.txt edited" "2 DONE check.sh ran" "3 REFUSED-SANDBOX Operation not permitted"
score "$pq" c1-control

cp "$pb" "$work/path-b.saved"
grep -v "^root U " "$work/path-b.saved" > "$pb"
run_case "$pu" "$tpu" c2-outside; rc=$?
expect "run-case refuses a root its path record does not list" '[ "$rc" -ne 0 ] && ! ran'
rm "$pb"
run_case "$pu" "$tpu" c2-outside; rc=$?
expect "run-case refuses a root whose path record is gone" '[ "$rc" -ne 0 ] && ! ran'
cp "$work/path-b.saved" "$pb"
run_case "$pu" "$tpu" c2-outside; rc=$?
expect "with its record restored and both controls passed, the root runs" '[ "$rc" -eq 0 ] && ran'

# --- item 5: production's profile and the project MCP fixture ---------------

pn="$parent/run-unchanged-p"
tpn=$(prepare_with "$unchanged_pkg" P "$pn")
listen "$pn"
run_case_with "$unchanged_pkg" "$pn" "$tpn" c1-control; rc=$?
expect "variant P refuses to run before production has the profile change" \
  '[ "$rc" -ne 0 ] && ! ran && [ ! -e "$pn/out/c1-control.argv" ] && [ ! -e "$pn/out/snap-c1-control-before.txt" ]'

uc="$parent/run-changed-u"
tuc=$(prepare_with "$changed_pkg" U "$uc")
listen "$uc"
run_case_with "$changed_pkg" "$uc" "$tuc" c1-control; rc=$?
expected_argv "$work/changed" c1-control "$uc" U 6 > "$work/expected.argv"
expect "variant U takes production's argv less the --setting-sources pair, keeping --strict-mcp-config" \
  '[ "$rc" -eq 0 ] && cmp -s "$work/expected.argv" "$L3_STANDIN_DIR/claude.argv" && ! argv_has "$L3_STANDIN_DIR/claude.argv" --setting-sources && argv_has "$L3_STANDIN_DIR/claude.argv" --strict-mcp-config'

ud="$parent/run-drift"
tud=$(prepare U "$ud")
listen "$ud"
(cd "$repo" && bun -e '
import { Result } from "effect"
import { claudeEditingSettings } from "./src/format/claude-settings.ts"
const rendered = claudeEditingSettings(process.argv[1])
if (Result.isFailure(rendered)) process.exit(3)
process.stdout.write(rendered.success)
' "$(cd "$ud" && pwd -P)/state/worktree") > "$work/drift-production.json"
/usr/bin/python3 -I - "$ud/claude-settings.json" "$work/drift-production.json" <<'PY'
import json, sys
rendered = json.load(open(sys.argv[1], encoding="utf-8"))
production = json.load(open(sys.argv[2], encoding="utf-8"))
allow = rendered["permissions"]["allow"]
at = allow.index("Bash(git diff *)")
ok = allow[at + 1] == "Bash(sh check.sh)" and allow.count("Bash(sh check.sh)") == 1
allow.remove("Bash(sh check.sh)")
sys.exit(0 if ok and rendered == production else 1)
PY
rc=$?
expect "setup writes production's settings with Bash(sh check.sh) right after Bash(git diff *)" '[ "$rc" -eq 0 ]'
cp -p "$ud/claude-settings.json" "$work/settings.saved"
printf ' ' >> "$ud/claude-settings.json"
run_case "$ud" "$tud" c1-control; rc=$?
expect "run-case refuses a root whose settings differ from production's current rendering" \
  '[ "$rc" -ne 0 ] && ! ran && [ ! -e "$ud/out/c1-control.argv" ]'
cp -p "$work/settings.saved" "$ud/claude-settings.json"

cleangit_test() {
  env -i PATH=/usr/bin:/bin HOME=/var/empty GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null git "$@"
}
expect "setup commits the project .mcp.json, and the worktree has it" \
  'cleangit_test -C "$ud/owner" cat-file -e HEAD:.mcp.json && [ -f "$ud/state/worktree/.mcp.json" ] && [ -z "$(cleangit_test -C "$ud/state/worktree" status --porcelain -- .mcp.json)" ]'
/usr/bin/python3 -I - "$ud/state/worktree/.mcp.json" "$ud/state/worktree/.claude/settings.json" "$(cd "$ud" && pwd -P)/out/mcp-server.log" <<'PY'
import json, sys
servers = json.load(open(sys.argv[1], encoding="utf-8"))["mcpServers"]
project = json.load(open(sys.argv[2], encoding="utf-8"))
server = servers["l3-marker"]
ok = (list(servers) == ["l3-marker"] and server["type"] == "stdio" and server["command"] == "/bin/sh"
      and server["args"] == ["-c", "echo started >> " + sys.argv[3]]
      and project.get("enabledMcpjsonServers") == ["l3-marker"] and project.get("enableAllProjectMcpServers") is True)
sys.exit(0 if ok else 1)
PY
rc=$?
expect "the fixture's server appends to the root's out/mcp-server.log, and project settings approve it" '[ "$rc" -eq 0 ]'
# Starting the fixture's server by hand, as a client would: it leaves one
# line and exits.
/usr/bin/python3 -I - "$ud/state/worktree/.mcp.json" "$ud/state/worktree" <<'PY'
import json, subprocess, sys
server = json.load(open(sys.argv[1], encoding="utf-8"))["mcpServers"]["l3-marker"]
subprocess.run([server["command"], *server["args"]], cwd=sys.argv[2], stdin=subprocess.DEVNULL, timeout=10, check=True)
PY
expect "the fixture's server, started by hand, leaves its marker and nothing else" \
  '[ "$(cat "$ud/out/mcp-server.log")" = started ] && [ -z "$(cleangit_test -C "$ud/state/worktree" status --porcelain)" ]'

L3_STANDIN_ACTION='echo started >> ../../out/mcp-server.log' run_case "$rg" "$tg" c3-protected-tools
refusals "$rg/out/c3-protected-tools.judged" 3
score "$rg" c3-protected-tools
expect "a run during which the project MCP server started scores FAIL" \
  '[ "$(outcome "$rg" c3-protected-tools)" = FAIL ] && grep -q "MCP server started" "$rg/out/c3-protected-tools.score" && [ "$(cat "$rg/out/c3-protected-tools-mcp-after")" = 1 ]'
run_case "$rg" "$tg" c5-direct
printf '%s\n' "1 REFUSED-PERMISSION d" "2 REFUSED-PERMISSION d" "3 REFUSED-PERMISSION d" "4 REFUSED-PERMISSION d" \
  "5 REFUSED-PERMISSION d" "6 REFUSED-SANDBOX d" "7 REFUSED-PERMISSION d" > "$rg/out/c5-direct.judged"
score "$rg" c5-direct
expect "a later run with the marker unchanged is not charged with it" \
  '[ "$(outcome "$rg" c5-direct)" = PASS ] && [ "$(cat "$rg/out/c5-direct-mcp-before")" = 1 ]'

# --- syntax --------------------------------------------------------------

for script in setup.sh teardown.sh snapshot.sh ownership.sh profile.sh prepare.sh run-case.sh test-scripts.sh; do
  expect "bash -n $script" 'bash -n "$here/$script"'
done
expect "score.py parses" '/usr/bin/python3 -I -c "import ast, sys; ast.parse(open(sys.argv[1]).read())" "$here/score.py"'

chmod -R u+w "$work"
rm -rf "$work"
if [ "$failures" -ne 0 ]; then
  printf '%s case(s) failed\n' "$failures"
  exit 1
fi
echo "all cases passed"
