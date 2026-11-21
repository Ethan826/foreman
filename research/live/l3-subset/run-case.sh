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
# variant's newest C1 attempt that began recording evidence to hold a
# current PASS: score.py --check), the path gate (every other Claude root
# in the root's path record whose C1 has begun holds a current PASS for
# that newest attempt), the
# listener's preflight (the first line of out/listener.log is this root's
# nonce request, answered 200), the commands on PATH, for Claude the
# root's settings equal to production's current rendering and the argv
# production builds (profile.sh), then the before evidence (snapshot,
# argv, index state, listener and MCP-marker counts). After the
# client, whatever its exit: the after evidence and the snapshot diff.
# Any failure there marks the run INVALID in out/<run>.evidence and exits
# 3; score.py then scores it INVALID. Exits 0 when the evidence is
# complete, whatever the client did.
#
# The Claude argv is production's claudeEditingArgv for the case's prompt
# and the root's settings file, followed by --max-turns. Variant P takes
# it whole and requires the profile change of open question 1
# (--setting-sources project,local and --strict-mcp-config); variant U
# takes it without the --setting-sources pair.
set -eu
set -o pipefail

here=$(cd "$(dirname "$0")" && pwd -P)
. "$here/ownership.sh"
. "$here/profile.sh"

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

# The evidence files this script writes for the run $1, in the order it
# writes them. The first, the before snapshot, is where an attempt begins
# recording evidence; a later file shows the same even if the earlier ones
# are gone.
run_files() {
  printf '%s\n' "snap-$1-before.txt" "$1.argv" "$1-index-before" "$1-listener-before" "$1-mcp-before" \
    "$1.jsonl" "$1.stderr" "$1-last.txt" "$1.exit" "snap-$1-after.txt" "$1-index-after" \
    "$1-listener-after" "$1-mcp-after" "$1.diff" "$1.evidence"
}
# Whether the run $2 in the out/ directory $1 began recording evidence.
began() {
  for name in $(run_files "$2"); do
    if [ -e "$1/$name" ] || [ -L "$1/$name" ]; then
      return 0
    fi
  done
  return 1
}

# Whether the newest C1 attempt of the root $1 that began recording
# evidence holds a current PASS (score.py --check: the stored PASS equals
# the score of the judgment and evidence as they are now). Every attempt
# number is looked at, so an attempt interrupted before its exit status,
# or one past a gap, is never passed over for an older PASS. Returns 0 if
# it does, 3 when no C1 attempt has begun in that root, 1 otherwise. Sets
# control to that attempt's run id.
control_state() {
  control=c1-control
  newest=0
  n=1
  while [ "$n" -le 99 ]; do
    if began "$1/out" "$(run_id c1-control "$n")"; then
      newest=$n
    fi
    n=$((n + 1))
  done
  [ "$newest" -gt 0 ] || return 3
  control=$(run_id c1-control "$newest")
  "$here/score.py" --check "$1" "$control" > /dev/null 2>&1 || return 1
}

# The control gate: a variant whose C1 has not passed runs nothing more.
if [ "$gated" = yes ]; then
  control_state "$root" ||
    stop "$control has no current PASS (score.py --check); a failed, unscored or since-changed control stops variant $variant"
fi

# The path gate: a Claude control that ran without a current PASS stops
# every root of the path (plan.md, "Stop and retry rules"). This root's
# own C1 is left to the control gate above and to the retry rule.
path_record=$(sed -n 's/^path //p' "$session")
[ -n "$path_record" ] || stop "this root's session names no path record"
if [ -L "$path_record" ] || [ ! -f "$path_record" ] || [ "$(head -n 1 "$path_record")" != "foreman-l3-path 1" ]; then
  stop "the path record $path_record is missing or not a path record"
fi
grep -qxF "root $variant $root" "$path_record" || stop "the path record does not list this root as variant $variant"
members=$(tail -n +2 "$path_record") || stop "the path record could not be read"
while read -r tag other_variant other_root; do
  [ "$tag" = root ] || continue
  case "$other_variant" in U|P) ;; *) continue ;; esac
  [ "$other_root" = "$root" ] && continue
  status=0
  control_state "$other_root" || status=$?
  if [ "$status" -eq 1 ]; then
    stop "variant $other_variant's $control in $other_root has no current PASS; a control that did not pass stops every root of its path"
  fi
done <<< "$members"

# The listener's preflight: the first line of its log is this root's
# nonce request, answered 200 by a listener serving this root's www/
# (plan.md, step 0). A bind error, another root's request or a request for
# another file is not a preflight. A listener started again truncates its
# log, so it needs a new preflight.
nonce=$(sed -n 's/^preflight //p' "$session")
case "$nonce" in
  ""|*[!0-9a-f]*) stop "this root's session has no preflight nonce" ;;
esac
first=
if [ -f "$out/listener.log" ] && [ ! -L "$out/listener.log" ]; then
  first=$(head -n 1 "$out/listener.log")
fi
preflight="^127\\.0\\.0\\.1 - - \\[[^]]*\\] \"GET /preflight-$nonce HTTP/1\\.[01]\" 200 [-0-9]+\$"
grep -qE "$preflight" <<< "$first" ||
  stop "the listener's log does not start with this root's preflight request answered 200 (plan.md, step 0)"

needed="gtimeout $client"
if [ "$client" = claude ]; then
  needed="$needed bun"
fi
for command in $needed; do
  command -v "$command" > /dev/null || stop "$command is not on PATH"
done

worktree="$root/state/worktree"
git_dir="$root/owner/.git/worktrees/worktree"
settings="$root/claude-settings.json"
prompt=$(cat "$prompt_file")

# The client's argv. Claude's comes from production (profile.sh): the
# root's settings must still equal production's rendering, and the argv is
# claudeEditingArgv's, with the variant's setting sources and the turn cap.
client_argv=()
if [ "$client" = claude ]; then
  fresh="$out/.$run.settings.partial"
  produced="$out/.$run.argv.partial"
  rm -f -- "$fresh" "$produced"
  l3_production_settings "$worktree" "$fresh" || stop "production's settings could not be rendered"
  same=yes
  cmp -s -- "$fresh" "$settings" || same=no
  rm -f -- "$fresh"
  [ "$same" = yes ] ||
    stop "the root's claude-settings.json differs from production's current settings; prepare a new root"
  l3_production_argv "$prompt" "$settings" "$produced" || stop "production's argv could not be built"
  production=()
  while IFS= read -r -d '' part; do production+=("$part"); done < "$produced"
  rm -f -- "$produced"
  if [ "${#production[@]}" -eq 0 ] || [ "${production[0]}" != claude ]; then
    stop "production's argv does not start with claude"
  fi
  has_sources=no
  has_strict=no
  i=0
  while [ "$i" -lt "${#production[@]}" ]; do
    part=${production[$i]}
    if [ "$part" = --setting-sources ]; then
      [ "${production[$((i + 1))]-}" = project,local ] ||
        stop "production passes --setting-sources with a value other than project,local"
      has_sources=yes
      if [ "$variant" = P ]; then
        client_argv+=("$part" project,local)
      fi
      i=$((i + 2))
      continue
    fi
    if [ "$part" = --strict-mcp-config ]; then
      has_strict=yes
    fi
    client_argv+=("$part")
    i=$((i + 1))
  done
  if [ "$variant" = P ] && { [ "$has_sources" = no ] || [ "$has_strict" = no ]; }; then
    stop "production's argv lacks --setting-sources project,local or --strict-mcp-config: path A runs only after the connector and MCP profile change (plan.md, open question 1)"
  fi
  client_argv+=(--max-turns "$turns")
  limit=600
else
  client_argv=(codex exec --sandbox read-only -c 'approval_policy="never"' --json
    --output-last-message "$out/$run-last.txt" "$prompt")
  limit=300
fi

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
# The lines the fixture's project MCP server appended: 0 before any start.
mcp_lines() {
  if [ -e "$out/mcp-server.log" ] || [ -L "$out/mcp-server.log" ]; then
    wc -l < "$out/mcp-server.log" | tr -d ' '
  else
    echo 0
  fi
}

# Before evidence. C6 first makes the index's stat data stale (plan.md, C6).
if [ "$case_id" = c6-index ]; then
  touch "$worktree/README.txt" || stop "README.txt could not be touched for C6"
fi
"$here/snapshot.sh" "$root" "$run-before" > /dev/null || stop "the before snapshot failed"
printf '%s\0' "${client_argv[@]}" > "$out/$run.argv" || stop "the argv could not be recorded"
index_state > "$out/$run-index-before" || stop "the index state could not be recorded"
listener_lines > "$out/$run-listener-before" || stop "the listener count could not be recorded"
mcp_lines > "$out/$run-mcp-before" || stop "the MCP marker count could not be recorded"

# The client, with every GIT_* variable removed from its environment
# (assisted plan 320, decision P2). Its exit status is evidence, not a
# reason to stop.
unset_git=()
for name in $(env | sed -n 's/^\(GIT_[A-Za-z0-9_]*\)=.*/\1/p'); do
  unset_git+=(-u "$name")
done
echo "run-case.sh: starting $client for $run" >&2
set +e
(cd "$worktree" && env ${unset_git[@]+"${unset_git[@]}"} gtimeout -k 5 "$limit" "${client_argv[@]}" \
  > "$out/$run.jsonl" 2> "$out/$run.stderr")
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
mcp_lines > "$out/$run-mcp-after" || fail_after "the MCP marker count could not be recorded"
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
