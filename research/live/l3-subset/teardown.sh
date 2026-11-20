#!/bin/bash
# L3 subset: remove what setup.sh created under a scratch root. Runs no
# agent client. It acts only on a root whose ownership record
# (<scratch-root>/.l3-owner, see ownership.sh) matches it, checks the
# whole record before removing anything, and removes only the top-level
# paths the record names. It changes no permission bits. The raw outputs
# in <scratch-root>/out are kept, as is anything the record does not
# name; delete those yourself once the whitelisted copies are committed.
#
# Usage: teardown.sh <scratch-root>
#
# The record goes last, so an interrupted teardown can be run again. Once
# a teardown finishes, the root has no record and a second one refuses.
set -eu

here=$(cd "$(dirname "$0")" && pwd -P)
. "$here/ownership.sh"

if [ $# -ne 1 ]; then
  echo "usage: teardown.sh <scratch-root>" >&2
  exit 2
fi
case "$1" in
  /*) ;;
  *) echo "teardown.sh: scratch root must be absolute: $1" >&2; exit 2 ;;
esac
if ! l3_canonicalize "$1"; then
  echo "teardown.sh: no such directory: $1" >&2
  exit 2
fi
scratch=$l3_canonical
if ! l3_check_record "$scratch"; then
  echo "teardown.sh: refusing; nothing was removed" >&2
  exit 2
fi

# The done marker first, so an interrupted teardown reads as a partial
# setup and snapshot.sh refuses it.
case " $l3_recorded_names " in
  *" .l3-setup-done "*) rm -f -- "$scratch/.l3-setup-done" ;;
esac
for name in $l3_recorded_names; do
  case "$name" in
    out|.l3-setup-done) ;;
    *) rm -rf -- "${scratch:?}/$name" ;;
  esac
done
rm -f -- "$scratch/$l3_record_name"
echo "teardown.sh: removed the recorded L3 paths (kept out/ and any unrecorded path)"
