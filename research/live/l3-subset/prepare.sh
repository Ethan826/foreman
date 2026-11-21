#!/bin/bash
# L3 subset: prepare one variant's scratch root for client runs. Runs no
# agent client.
#
# Usage: prepare.sh <U|P|X> <scratch-root> <path-record> [--temp-ok]
#
# U and P are the Claude variants (plan.md, "Setting-source variants");
# X is the Codex root. prepare.sh runs setup.sh on a new root, writes the
# Codex fixture for X, writes the listener's preflight file, takes the
# baseline snapshot and then writes <scratch-root>/out/session with the
# variant, a fresh random token, the preflight nonce and the path record.
# It prints only the token on stdout; everything else goes to stderr.
# run-case.sh starts a client only with the token of the root's session,
# so a failed prepare (no token printed) or a root left from an earlier
# session (another token) can never reach a client. --temp-ok is passed
# to setup.sh and is for testing these scripts only.
#
# <path-record> binds the roots of one authorized path (plan.md, "Order
# and cases"): an absolute file path of letters, digits, ".", "_", "+",
# "-" and "/", in an existing directory. The first prepare.sh of a path
# creates it; each later one adds its root. A record holds at most one
# root per variant. run-case.sh reads it to stop every root of the path
# once any Claude control in it has run without a current PASS (plan.md,
# "Stop and retry rules").
#
# The preflight nonce names the file www/preflight-<nonce>, which only
# this root's listener serves; plan.md, step 0, requests it, and
# run-case.sh looks for that request, answered 200, as the first line of
# the root's listener log.
set -eu

here=$(cd "$(dirname "$0")" && pwd -P)
. "$here/ownership.sh"

if [ $# -lt 3 ] || [ $# -gt 4 ]; then
  echo "usage: prepare.sh <U|P|X> <scratch-root> <path-record> [--temp-ok]" >&2
  exit 2
fi
variant=$1
case "$variant" in
  U|P|X) ;;
  *) echo "prepare.sh: the variant is U, P or X" >&2; exit 2 ;;
esac
stop() {
  echo "prepare.sh: $1; no client may run on this root. Choose a new path and prepare again" >&2
  exit 2
}

# The path record, checked before setup so a bad one creates no root.
path_header="foreman-l3-path 1"
case "$3" in
  /*) ;;
  *) echo "prepare.sh: the path record must be an absolute path" >&2; exit 2 ;;
esac
case "$3" in
  */|*//*|*[!ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._+/-]*)
    echo "prepare.sh: the path record may hold only letters, digits, . _ + - and /, with no doubled or trailing slash" >&2
    exit 2 ;;
esac
if ! l3_canonicalize "${3%/*}/"; then
  echo "prepare.sh: the path record's directory does not exist" >&2
  exit 2
fi
path_record="${l3_canonical%/}/${3##*/}"
if [ -e "$path_record" ] || [ -L "$path_record" ]; then
  if [ -L "$path_record" ] || [ ! -f "$path_record" ] || [ "$(head -n 1 "$path_record")" != "$path_header" ]; then
    echo "prepare.sh: $3 exists and is not a path record" >&2
    exit 2
  fi
  if grep -q "^root $variant " "$path_record"; then
    echo "prepare.sh: the path record already has a variant $variant root; a new path takes a new record" >&2
    exit 2
  fi
fi
temp_ok=
if [ $# -eq 4 ]; then
  temp_ok=$4
fi

# setup.sh refuses a root that already exists, so a token is only ever
# printed for a root this call created.
"$here/setup.sh" "$2" ${temp_ok:+"$temp_ok"} >&2 || stop "setup.sh failed"
set -- "$2"
l3_canonicalize "$1" || stop "the new root cannot be resolved"
root=$l3_canonical
l3_check_record "$root" || stop "the new root's ownership record does not match"

# The Codex fixture: the edit C1's Edit tool makes in a Claude root, made
# here by the script so the Codex cases do not depend on any Claude run.
if [ "$variant" = X ]; then
  printf 'alpha-edited\n' > "$root/state/worktree/notes.txt" || stop "the Codex fixture could not be written"
fi

# 32 random hex digits, or nothing.
draw() {
  drawn=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n') || return 1
  [ ${#drawn} -eq 32 ]
}

draw || stop "no preflight nonce could be drawn"
nonce=$drawn
( set -C
  printf '%s\n' "$nonce" > "$root/www/preflight-$nonce" ) || stop "the preflight file could not be written"

"$here/snapshot.sh" "$root" baseline >&2 || stop "the baseline snapshot failed"

draw || stop "no token could be drawn"
token=$drawn
( set -C
  printf 'variant %s\ntoken %s\npreflight %s\npath %s\n' "$variant" "$token" "$nonce" "$path_record" > "$root/out/session" ) ||
  stop "the session could not be recorded"

# The root joins its path last; run-case.sh refuses a root its record
# does not list. set -C creates the record only if it is still absent.
if [ ! -e "$path_record" ]; then
  ( set -C
    printf '%s\n' "$path_header" > "$path_record" ) || stop "the path record could not be created"
fi
grep -q "^root $variant " "$path_record" && stop "the path record gained a variant $variant root meanwhile"
printf 'root %s %s\n' "$variant" "$root" >> "$path_record" || stop "the root could not be added to the path record"
printf '%s\n' "$token"
