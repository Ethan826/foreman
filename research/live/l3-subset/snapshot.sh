#!/bin/bash
# L3 subset: write a manifest of the whole scratch root except out/, so
# two snapshots taken around a client run show every path the run changed,
# including paths setup.sh never created. Runs no agent client and writes
# only under <scratch-root>/out.
#
# Usage: snapshot.sh <scratch-root> <label>
# Writes <scratch-root>/out/snap-<label>.txt: one line per path, sorted
# by its bytes, with the file type, the permission bits, the path relative
# to the root and the SHA-256 of the content (or the target of a symbolic
# link). Paths and link targets are written with bash's printf %q, so a
# newline, quote or space in a name stays on its own line and cannot be
# confused with another entry. Compare two manifests with diff.
#
# Any error while listing the tree or reading a file fails the snapshot,
# and no manifest is written for that label.
set -eu
set -o pipefail

here=$(cd "$(dirname "$0")" && pwd -P)
. "$here/ownership.sh"

if [ $# -ne 2 ]; then
  echo "usage: snapshot.sh <scratch-root> <label>" >&2
  exit 2
fi
label=$2
case "$label" in
  *[!A-Za-z0-9._-]*|"") echo "snapshot.sh: label must be [A-Za-z0-9._-]+" >&2; exit 2 ;;
esac
if ! l3_canonicalize "$1"; then
  echo "snapshot.sh: no such directory: $1" >&2
  exit 2
fi
scratch=$l3_canonical
if ! l3_check_record "$scratch"; then
  echo "snapshot.sh: refusing" >&2
  exit 2
fi
if [ ! -f "$scratch/.l3-setup-done" ]; then
  echo "snapshot.sh: no completed L3 setup in this root" >&2
  exit 2
fi
out="$scratch/out"
if [ -L "$out" ] || [ ! -d "$out" ]; then
  echo "snapshot.sh: out/ is missing or not a directory" >&2
  exit 2
fi
manifest="$out/snap-$label.txt"
listing="$out/.snap-$label.list"
partial="$out/.snap-$label.partial"
trap 'rm -f -- "$listing" "$partial"' EXIT

# Prints one manifest line for a path. Called in a || list, where set -e
# does not apply, so every step returns its own failure.
describe() {
  path=$1
  rel=$(printf '%q' "$path") || return 1
  mode=$(stat -f %Lp "$path") || return 1
  if [ -L "$path" ]; then
    target=$(readlink "$path" && echo x) || return 1
    printf 'link %s %s -> %q\n' "$mode" "$rel" "${target%?x}"
  elif [ -f "$path" ]; then
    hash=$(shasum -a 256 < "$path") || return 1
    printf 'file %s %s %s\n' "$mode" "$rel" "${hash%% *}"
  elif [ -d "$path" ]; then
    printf 'dir  %s %s\n' "$mode" "$rel"
  else
    printf 'other %s %s\n' "$mode" "$rel"
  fi
}

cd -P -- "$scratch"
# NUL-separated, so no name can split or merge entries.
find . -path ./out -prune -o -print0 | LC_ALL=C sort -z > "$listing"
while IFS= read -r -d '' path; do
  describe "$path" || exit 1
done < "$listing" > "$partial"
mv -- "$partial" "$manifest"
echo "$manifest"
