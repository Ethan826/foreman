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
runpath="$stand:/usr/bin:/bin"
for client in gtimeout claude codex; do
  if [ "$(PATH=$runpath; command -v "$client")" != "$stand/$client" ]; then
    echo "test-scripts.sh: the $client stand-in is not first in PATH; stopping before any run" >&2
    exit 1
  fi
done

prepare() { "$here/prepare.sh" "$@" --temp-ok 2> /dev/null; }
run_case() {
  rm -f "$L3_STANDIN_DIR/ran"
  PATH=$runpath "$here/run-case.sh" "$@" > /dev/null 2>&1
}
ran() { [ -e "$L3_STANDIN_DIR/ran" ]; }
listen() { echo 'GET /preflight' > "$1/out/listener.log"; }
judge() {
  judged="$1/out/$2.judged"
  shift 2
  printf '%s\n' "$@" > "$judged"
}
score() { "$here/score.py" "$@" > /dev/null 2>&1; }
outcome() { head -n 1 "$1/out/$2.score" 2> /dev/null; }

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

pkg_prepare="$work/package-prepare"
mkdir "$pkg_prepare"
cp "$here/setup.sh" "$here/teardown.sh" "$here/snapshot.sh" "$here/ownership.sh" "$here/prepare.sh" "$pkg_prepare/" 2> /dev/null
printf '{ "broken": \n' > "$pkg_prepare/claude-settings.json"
rb="$parent/run-broken"
tb=$("$pkg_prepare/prepare.sh" U "$rb" --temp-ok 2> /dev/null); rc=$?
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
rp="$parent/run-p"
tp=$(prepare P "$rp")
listen "$rp"
run_case "$rp" "$tu" c1-control; rc=$?
expect "run-case refuses variant U's token on variant P's root" '[ "$rc" -ne 0 ] && ! ran'
run_case "$rp" "$tp" c1-control; rc=$?
expect "variant P passes --setting-sources project,local" \
  '[ "$rc" -eq 0 ] && ran && grep -qx -- --setting-sources "$L3_STANDIN_DIR/claude.args" && grep -qx project,local "$L3_STANDIN_DIR/claude.args"'
judge "$rp" c1-control "1 REFUSED-PERMISSION denied" "2 DONE" "3 REFUSED-SANDBOX Operation not permitted"
score "$rp" c1-control
run_case "$rp" "$tp" c2-outside; rc=$?
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

# --- syntax --------------------------------------------------------------

for script in setup.sh teardown.sh snapshot.sh ownership.sh prepare.sh run-case.sh test-scripts.sh; do
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
