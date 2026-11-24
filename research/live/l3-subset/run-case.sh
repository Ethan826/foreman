#!/bin/bash
# L3 subset: one client run with its evidence. The only way the package
# starts a client.
#
# Usage: run-case.sh [--offline] <scratch-root> <token> <case> [<attempt>]
#
# The listener's port is 47613, which the prompts name. Only the offline
# tests may set another in L3_PORT (port.sh), and they say so with
# --offline, which changes nothing else. A malformed L3_PORT stops the
# script first; a well-formed one without --offline stops it next, so a
# live run never sends its requests to a port the prompts do not name.
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
# listener's setup-time preflight (the first line of out/listener.log is
# this root's nonce request, answered 200), a live request to the
# listener (below), the commands on PATH, for Claude the root's settings
# equal to production's current rendering and the argv production builds
# (profile.sh), then the before evidence (snapshot, argv, index state, a
# second live request, listener and MCP-marker counts). After the client,
# whatever its exit: the after evidence (with a third live request), for
# C6 the reference run of its two git commands, and the snapshot diff.
# Any failure there marks the run INVALID in out/<run>.evidence and exits
# 3; score.py then scores it INVALID. Exits 0 when the evidence is
# complete, whatever the client did.
#
# A live request is this script's own request, from outside the client,
# for the root's preflight file with a query holding a nonce drawn for
# this launch. It holds only when the listener answers 200 and a new line
# for exactly that request, answered 200, appears in out/listener.log. A
# 200 for the file shows a listener serving this root's www/; the new
# line with this launch's nonce shows that it logs to this root's log
# now, not only earlier. The request just before the client starts and
# the one after it exits are recorded in out/<run>-listener-live: a
# listener down or replaced by then makes the run INVALID, since a
# request the agent made could have gone unlogged.
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
. "$here/port.sh"

stop() {
  echo "run-case.sh: $1; no client was started" >&2
  exit 2
}

offline=no
if [ "${1-}" = --offline ]; then
  offline=yes
  shift
fi
if [ $# -lt 3 ] || [ $# -gt 4 ]; then
  echo "usage: run-case.sh [--offline] <scratch-root> <token> <case> [<attempt>]" >&2
  exit 2
fi
# The listener's port (port.sh): 47613, which the prompts name, unless
# the offline tests set L3_PORT and pass --offline; checked before
# anything else.
port=$(l3_listener_port 2>&1) || stop "$port"
if [ -n "${L3_PORT+set}" ] && [ "$offline" != yes ]; then
  echo "run-case.sh: L3_PORT is set ($L3_PORT), but the live run uses $l3_default_port, which the prompts name; only the offline tests (--offline) may set it; no client was started" >&2
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
  printf '%s\n' "snap-$1-before.txt" "$1.argv" "$1-index-before" "$1-listener-live" "$1-listener-before" "$1-mcp-before" \
    "$1.jsonl" "$1.stderr" "$1-last.txt" "$1.exit" "snap-$1-after.txt" "$1-index-after" \
    "$1-ref-status.stdout" "$1-ref-status.stderr" "$1-ref-status.exit" \
    "$1-ref-stat.stdout" "$1-ref-stat.stderr" "$1-ref-stat.exit" \
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

# The listener's setup-time preflight: the first line of its log is this
# root's nonce request, answered 200 by a listener serving this root's
# www/ (plan.md, step 0). A bind error, another root's request or a
# request for another file is not a preflight. A listener started again
# truncates its log, so it needs a new preflight. The line was written
# when the operator checked the listener and does not show that it is
# still up; the live requests below establish that.
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

# A nonce for this launch.
launch=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n') || stop "no launch nonce could be drawn"
[ ${#launch} -eq 32 ] || stop "no launch nonce could be drawn"

# live <stage>: this script's own request to the listener for the root's
# preflight file, with "?<launch>-<stage>" as its query, from outside the
# client and to localhost only (no proxy). Returns 0 only when the
# listener answers 200 and a line of out/listener.log past those it held
# before the request is exactly that request, answered 200. Sets
# live_why to the reason otherwise. http.server writes the line before
# the response's body, so it is normally there when curl returns; the
# loop allows two seconds for the write.
live() {
  live_why=
  log="$out/listener.log"
  if [ -L "$log" ] || [ ! -f "$log" ]; then
    live_why="out/listener.log is missing or not a regular file"
    return 1
  fi
  held=$(wc -l < "$log" | tr -d ' ') || { live_why="out/listener.log could not be read"; return 1; }
  code=$(/usr/bin/curl -g -s --noproxy '*' --max-time 5 -o /dev/null -w '%{http_code}' \
    "http://127.0.0.1:$port/preflight-$nonce?$launch-$1") || true
  if [ "$code" != 200 ]; then
    live_why="the listener on 127.0.0.1:$port answered ${code:-nothing}, not 200, for this root's preflight file"
    return 1
  fi
  line="^127\\.0\\.0\\.1 - - \\[[^]]*\\] \"GET /preflight-$nonce\\?$launch-$1 HTTP/1\\.[01]\" 200 [-0-9]+\$"
  tries=0
  while [ "$tries" -lt 20 ]; do
    if tail -n +"$((held + 1))" "$log" | grep -qE "$line"; then
      return 0
    fi
    sleep 0.1
    tries=$((tries + 1))
  done
  live_why="the listener answered 200, but out/listener.log gained no line for this request, so it is not the listener logging there"
  return 1
}

# The first live request, before any evidence is written: a listener that
# is down, serves another root or logs elsewhere stops here, and the run
# id stays unused.
live ready || stop "the listener is not live for this root: $live_why"

needed="gtimeout $client"
if [ "$client" = claude ]; then
  needed="$needed bun"
fi
for command in $needed; do
  command -v "$command" > /dev/null || stop "$command is not on PATH"
done

worktree="$root/state/worktree"
git_dir="$root/owner/.git/worktrees/worktree"
common_dir="$root/owner/.git"
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
  l3_production_settings "$worktree" "$git_dir" "$common_dir" "$fresh" || stop "production's settings could not be rendered"
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
# reference_run <name> <git argument>...: one command of the reference run.
reference_run() {
  ref_name=$1
  shift
  ref_status=0
  (cd "$worktree" && env ${unset_git[@]+"${unset_git[@]}"} GIT_INDEX_FILE="$copy" git "$@" \
    > "$out/$run-ref-$ref_name.stdout" 2> "$out/$run-ref-$ref_name.stderr") || ref_status=$?
  if ! echo "$ref_status" > "$out/$run-ref-$ref_name.exit"; then
    reference_why="the reference run of git $* could not be recorded"
    return 1
  fi
}
# C6's reference (plan.md, C6): git status and git diff --stat run by this
# script in the worktree after the client exits, in the environment the
# client got (this script's, minus GIT_*, as the launch below builds it;
# not setup's clean runner), so the owner's git configuration and locale
# apply as they did to the agent's git. GIT_INDEX_FILE points at a fresh
# copy of the worktree's index in out/, so the reference never writes the
# real index; the copy is removed after. Each command's stdout, stderr and
# exit status are evidence (out/<run>-ref-status.* and -ref-stat.*); a
# nonzero exit is recorded, not a failure here. Fails, with reference_why
# set, when a record cannot be written or the real index changed.
reference() {
  reference_why=
  copy="$out/.$run-ref-index"
  rm -f -- "$copy" "$copy.lock"
  if ! cp -- "$git_dir/index" "$copy"; then
    reference_why="the index could not be copied for the reference run"
    return 1
  fi
  reference_run status status || return 1
  reference_run stat diff --stat || return 1
  rm -f -- "$copy" "$copy.lock"
  now=$(index_state) || { reference_why="the index state could not be read after the reference run"; return 1; }
  if [ "$now" != "$(cat "$out/$run-index-after")" ]; then
    reference_why="the worktree's index changed during the reference run"
    return 1
  fi
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
# The live request just before the client starts, recorded with the one
# after it exits. It comes after the before snapshot, so a failure here
# uses up the run id: the next attempt takes the next number.
if live launch; then
  printf 'launch %s 200\n' "$launch" > "$out/$run-listener-live" || stop "the listener's live request could not be recorded"
else
  printf 'launch %s failed: %s\n' "$launch" "$live_why" > "$out/$run-listener-live" || true
  stop "the listener is not live for this root just before launch: $live_why"
fi
listener_lines > "$out/$run-listener-before" || stop "the listener count could not be recorded"
mcp_lines > "$out/$run-mcp-before" || stop "the MCP marker count could not be recorded"

# The client, with every GIT_* variable removed from its environment
# (assisted plan 320, decision P2). Its exit status is evidence, not a
# reason to stop. C6's reference run below gets the same environment.
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
if [ "$case_id" = c6-index ]; then
  reference || fail_after "$reference_why"
fi
listener_lines > "$out/$run-listener-after" || fail_after "the listener count could not be recorded"
mcp_lines > "$out/$run-mcp-after" || fail_after "the MCP marker count could not be recorded"
# The live request after the client, past the counts, so its own line is
# not counted as the agent's.
if live after; then
  printf 'after %s 200\n' "$launch" >> "$out/$run-listener-live" || fail_after "the listener's live request could not be recorded"
else
  printf 'after %s failed: %s\n' "$launch" "$live_why" >> "$out/$run-listener-live" || true
  fail_after "the listener was not live after the client: $live_why"
fi
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
