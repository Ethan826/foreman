#!/bin/bash
# L3 subset: one client run with its evidence. The only way the package
# starts a client.
#
# Usage: run-case.sh <scratch-root> <token> <case> [<attempt>]
#
# <token> is what prepare.sh printed for this root. <case> is a prompt
# name in prompts/ (c1-control to c6-index on a U or P root, x1-read or
# x2-write on the X root). <attempt> is 1 by default; a rerun allowed by
# plan.md ("Stop and retry rules") takes the next number, and its run id
# is <case>-a<attempt>.
#
# Before the client, in order, and stopping at the first failure with no
# client started: the session token, the completed setup, the baseline,
# the case's variant, unused run ids, the control gate (C2 to C6 need the
# variant's latest C1 attempt scored PASS by score.py), the listener's
# preflight line, the client commands on PATH, then the before evidence
# (snapshot, index state, listener count). After the client, whatever its
# exit: the after evidence and the snapshot diff. Any failure there
# marks the run INVALID in out/<run>.evidence and exits 3; score.py then
# scores it INVALID. Exits 0 when the evidence is complete, whatever the
# client did.
set -eu
set -o pipefail

here=$(cd "$(dirname "$0")" && pwd -P)
. "$here/ownership.sh"

stop() {
  echo "run-case.sh: $1; no client was started" >&2
  exit 2
}

if [ $# -lt 3 ] || [ $# -gt 4 ]; then
  echo "usage: run-case.sh <scratch-root> <token> <case> [<attempt>]" >&2
  exit 2
fi
token=$2
case_id=$3
attempt=${4:-1}
case "$attempt" in
  [1-9]|[1-9][0-9]) ;;
  *) stop "the attempt is a number from 1 to 99" ;;
esac
case "$token" in
  ""|*[!0-9a-f]*) stop "no session token: prepare.sh must succeed for this root, and its token goes here" ;;
esac

# The root and its session.
l3_canonicalize "$1" || stop "no such directory: $1"
root=$l3_canonical
l3_check_record "$root" || stop "the root's ownership record does not match"
[ -f "$root/.l3-setup-done" ] || stop "setup did not complete in this root"
out="$root/out"
session="$out/session"
if [ -L "$session" ] || [ ! -f "$session" ]; then
  stop "this root has no session: prepare.sh did not finish"
fi
variant=$(sed -n 's/^variant //p' "$session")
[ "$token" = "$(sed -n 's/^token //p' "$session")" ] ||
  stop "the token is not this root's session token (another root, or an earlier session)"
[ -f "$out/snap-baseline.txt" ] || stop "this root has no baseline snapshot"

# The case and its client, from the variant prepare.sh recorded.
gated=yes
case "$variant:$case_id" in
  [UP]:c1-control) client=claude turns=6 gated=no ;;
  [UP]:c2-outside|[UP]:c3-protected-tools|[UP]:c5-direct) client=claude turns=12 ;;
  [UP]:c4-sandbox|[UP]:c6-index) client=claude turns=6 ;;
  X:x1-read|X:x2-write) client=codex gated=no ;;
  *) stop "case $case_id is not one of variant $variant's cases" ;;
esac
prompt_file="$here/prompts/$case_id.txt"
[ -f "$prompt_file" ] || stop "no prompt for $case_id"

# Run ids: <case> for attempt 1, <case>-a<n> after it. Evidence is never
# overwritten, and an attempt needs the one before it to have started its
# before evidence (a run whose before evidence failed part way keeps its
# id, so the next attempt takes the next number).
run_id() {
  if [ "$2" -eq 1 ]; then printf '%s' "$1"; else printf '%s-a%s' "$1" "$2"; fi
}
run=$(run_id "$case_id" "$attempt")
for existing in "$out/$run".* "$out/$run"-* "$out/snap-$run"-*; do
  if [ -e "$existing" ]; then
    stop "run $run already has evidence; a rerun allowed by plan.md takes the next attempt number"
  fi
done
if [ "$attempt" -gt 1 ]; then
  previous=$(run_id "$case_id" $((attempt - 1)))
  [ -e "$out/$previous.exit" ] || [ -e "$out/snap-$previous-before.txt" ] ||
    stop "attempt $attempt needs attempt $((attempt - 1)) first"
fi

# The control gate: a variant whose C1 has not passed runs nothing more.
if [ "$gated" = yes ]; then
  n=1
  while [ -e "$out/$(run_id c1-control $((n + 1))).exit" ]; do n=$((n + 1)); done
  control=$(run_id c1-control "$n")
  [ "$(head -n 1 "$out/$control.score" 2> /dev/null)" = PASS ] ||
    stop "$control has not scored PASS; a failed or unscored control stops variant $variant"
fi

[ -s "$out/listener.log" ] || stop "the listener has not logged its preflight request (plan.md, step 0)"
for command in gtimeout "$client"; do
  command -v "$command" > /dev/null || stop "$command is not on PATH"
done

worktree="$root/state/worktree"
git_dir="$root/owner/.git/worktrees/worktree"
# The index's modification time, size and SHA-256. Called in || lists,
# where set -e does not apply, so each step returns its own failure.
index_state() {
  index_stat=$(stat -f '%m %z' "$git_dir/index") || return 1
  index_hash=$(shasum -a 256 < "$git_dir/index") || return 1
  printf '%s %s\n' "$index_stat" "${index_hash%% *}"
}
listener_lines() {
  wc -l < "$out/listener.log" | tr -d ' '
}

# Before evidence. C6 first makes the index's stat data stale (plan.md, C6).
if [ "$case_id" = c6-index ]; then
  touch "$worktree/README.txt" || stop "README.txt could not be touched for C6"
fi
"$here/snapshot.sh" "$root" "$run-before" > /dev/null || stop "the before snapshot failed"
index_state > "$out/$run-index-before" || stop "the index state could not be recorded"
listener_lines > "$out/$run-listener-before" || stop "the listener count could not be recorded"

# The client, with every GIT_* variable removed from its environment
# (assisted plan 320, decision P2). Its exit status is evidence, not a
# reason to stop.
unset_git=()
for name in $(env | sed -n 's/^\(GIT_[A-Za-z0-9_]*\)=.*/\1/p'); do
  unset_git+=(-u "$name")
done
sources=()
if [ "$variant" = P ]; then
  sources=(--setting-sources project,local)
fi
prompt=$(cat "$prompt_file")
echo "run-case.sh: starting $client for $run" >&2
set +e
if [ "$client" = claude ]; then
  (cd "$worktree" && env ${unset_git[@]+"${unset_git[@]}"} gtimeout -k 5 600 claude \
    -p "$prompt" \
    --permission-mode dontAsk --permission-prompts none \
    --settings "$root/claude-settings.json" ${sources[@]+"${sources[@]}"} \
    --output-format stream-json --verbose --max-turns "$turns" \
    > "$out/$run.jsonl" 2> "$out/$run.stderr")
else
  (cd "$worktree" && env ${unset_git[@]+"${unset_git[@]}"} gtimeout -k 5 300 codex exec \
    --sandbox read-only -c 'approval_policy="never"' --json \
    --output-last-message "$out/$run-last.txt" \
    "$prompt" \
    > "$out/$run.jsonl" 2> "$out/$run.stderr")
fi
client_exit=$?
set -e

# After evidence. Each step runs whatever happened before it; the first
# failure is the reason recorded.
invalid=
fail_after() {
  [ -n "$invalid" ] || invalid=$1
}
echo "$client_exit" > "$out/$run.exit" || fail_after "the exit status could not be recorded"
"$here/snapshot.sh" "$root" "$run-after" > /dev/null || fail_after "the after snapshot failed"
index_state > "$out/$run-index-after" || fail_after "the index state could not be recorded"
listener_lines > "$out/$run-listener-after" || fail_after "the listener count could not be recorded"
diff_status=0
diff "$out/snap-$run-before.txt" "$out/snap-$run-after.txt" > "$out/$run.diff" || diff_status=$?
[ "$diff_status" -le 1 ] || fail_after "diff failed with status $diff_status"
if [ -n "$invalid" ]; then
  printf 'INVALID: %s\n' "$invalid" > "$out/$run.evidence"
  echo "run-case.sh: $run is INVALID: $invalid. The client ran; its result cannot be scored" >&2
  exit 3
fi
echo valid > "$out/$run.evidence"
echo "run-case.sh: $run done (client exit $client_exit). Judge it in out/$run.judged, then run score.py" >&2
