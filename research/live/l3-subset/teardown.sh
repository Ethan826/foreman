#!/bin/bash
# L3 subset: remove what setup.sh created under a scratch directory. Runs
# no agent client and removes only the paths setup.sh names. The raw
# outputs in <scratch-dir>/out are kept; delete them yourself once the
# whitelisted copies are committed.
#
# Usage: teardown.sh <scratch-dir>
#
# Idempotent: paths already gone are skipped.
set -eu

if [ $# -ne 1 ]; then
  echo "usage: teardown.sh <scratch-dir>" >&2
  exit 2
fi
case "$1" in
  /*) ;;
  *) echo "teardown.sh: scratch dir must be absolute: $1" >&2; exit 2 ;;
esac
if [ ! -d "$1" ]; then
  echo "teardown.sh: nothing to do; $1 does not exist"
  exit 0
fi
scratch=$(cd "$1" && pwd -P)
if [ "$scratch" = "/" ] || [ "$scratch" = "$(cd "$HOME" && pwd -P)" ]; then
  echo "teardown.sh: refusing scratch dir $scratch" >&2
  exit 2
fi

# Only a directory setup.sh prepared (or began to prepare) is touched.
if [ ! -f "$scratch/.l3-setup-done" ] && [ ! -d "$scratch/owner" ] \
  && [ ! -d "$scratch/state" ] && [ ! -d "$scratch/remote.git" ]; then
  echo "teardown.sh: no L3 setup found in $scratch; nothing to do"
  exit 0
fi

# Remove the done marker first, so an interrupted teardown reads as a
# partial setup and setup.sh refuses it.
rm -f "$scratch/.l3-setup-done"
for name in state owner remote.git outside www home; do
  path="$scratch/$name"
  if [ -e "$path" ] || [ -L "$path" ]; then
    # A test run may leave read-only files; make them removable first.
    chmod -R u+w "$path" 2>/dev/null || true
    rm -rf "$path"
  fi
done
rm -f "$scratch/claude-settings.json" "$scratch/layout.env"
echo "teardown.sh: removed the L3 setup in $scratch (kept $scratch/out if present)"
