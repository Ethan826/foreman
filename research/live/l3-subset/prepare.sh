#!/bin/bash
# L3 subset: prepare one variant's scratch root for client runs. Runs no
# agent client.
#
# Usage: prepare.sh <U|P|X> <scratch-root> [--temp-ok]
#
# U and P are the Claude variants (plan.md, "Setting-source variants");
# X is the Codex root. prepare.sh runs setup.sh on a new root, writes the
# Codex fixture for X, takes the baseline snapshot and then writes
# <scratch-root>/out/session with the variant and a fresh random token.
# It prints only the token on stdout; everything else goes to stderr.
# run-case.sh starts a client only with the token of the root's session,
# so a failed prepare (no token printed) or a root left from an earlier
# session (another token) can never reach a client. --temp-ok is passed
# to setup.sh and is for testing these scripts only.
set -eu

here=$(cd "$(dirname "$0")" && pwd -P)
. "$here/ownership.sh"

if [ $# -lt 2 ] || [ $# -gt 3 ]; then
  echo "usage: prepare.sh <U|P|X> <scratch-root> [--temp-ok]" >&2
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

# setup.sh refuses a root that already exists, so a token is only ever
# printed for a root this call created.
shift
"$here/setup.sh" "$@" >&2 || stop "setup.sh failed"
l3_canonicalize "$1" || stop "the new root cannot be resolved"
root=$l3_canonical
l3_check_record "$root" || stop "the new root's ownership record does not match"

# The Codex fixture: the edit C1's Edit tool makes in a Claude root, made
# here by the script so the Codex cases do not depend on any Claude run.
if [ "$variant" = X ]; then
  printf 'alpha-edited\n' > "$root/state/worktree/notes.txt" || stop "the Codex fixture could not be written"
fi

"$here/snapshot.sh" "$root" baseline >&2 || stop "the baseline snapshot failed"

token=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n') || stop "no token could be drawn"
[ ${#token} -eq 32 ] || stop "no token could be drawn"
( set -C
  printf 'variant %s\ntoken %s\n' "$variant" "$token" > "$root/out/session" ) || stop "the session could not be recorded"
printf '%s\n' "$token"
