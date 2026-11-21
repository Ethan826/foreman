#!/bin/bash
# Offline tests for setup.sh, teardown.sh and snapshot.sh. Runs no agent
# client and makes no network call; every path it touches is under a
# fresh directory it creates below the base given, which it removes at
# the end. The base must be outside every git repository.
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

# Partial setup: a broken template makes setup fail after its git steps.
pkg="$work/package"
mkdir "$pkg"
cp "$here/setup.sh" "$here/teardown.sh" "$here/snapshot.sh" "$here/ownership.sh" "$pkg/" 2>/dev/null
printf '{ "broken": \n' > "$pkg/claude-settings.json"
root="$parent/partial"
"$pkg/setup.sh" "$root" --temp-ok > /dev/null 2>&1; rc=$?
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

# --- syntax --------------------------------------------------------------

for script in setup.sh teardown.sh snapshot.sh ownership.sh test-scripts.sh; do
  expect "bash -n $script" 'bash -n "$here/$script"'
done

chmod -R u+w "$work"
rm -rf "$work"
if [ "$failures" -ne 0 ]; then
  printf '%s case(s) failed\n' "$failures"
  exit 1
fi
echo "all cases passed"
