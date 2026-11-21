#!/bin/bash
# L3 subset: write a manifest of the whole scratch root except out/, so
# two snapshots taken around a client run show every path the run changed,
# including paths setup.sh never created. Runs no agent client and writes
# only under <scratch-root>/out.
#
# Usage: snapshot.sh <scratch-root> <label>
# Writes <scratch-root>/out/snap-<label>.txt: one line per path, sorted
# by its bytes, of five tab-separated fields:
#
#   <type> <mode> <path-hex> <detail> <path-shown>
#
# <type> is file, dir, link or other; <mode> the permission bits in octal;
# <path-hex> the bytes of the path relative to the root, as lowercase hex;
# <detail> the SHA-256 of a file's content, the hex of a link's target, or
# "-" for a directory or other entry; <path-shown> the path in bash's
# printf %q, for people reading a diff. score.py keys entries by
# <path-hex> and compares the type, mode and detail. Neither hex nor %q
# ever holds a raw tab or newline, so a name with a newline, quote, tab or
# space stays on its own line and in its own field. Compare two manifests
# with diff.
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
  shown=$(printf '%q' "$path") || return 1
  path_hex=$(l3_hex "$path") || return 1
  mode=$(stat -f %Lp "$path") || return 1
  if [ -L "$path" ]; then
    target=$(readlink "$path" && echo x) || return 1
    detail=$(l3_hex "${target%?x}") || return 1
    kind=link
  elif [ -f "$path" ]; then
    hash=$(shasum -a 256 < "$path") || return 1
    detail=${hash%% *}
    kind=file
  elif [ -d "$path" ]; then
    detail=-
    kind=dir
  else
    detail=-
    kind=other
  fi
  printf '%s\t%s\t%s\t%s\t%s\n' "$kind" "$mode" "$path_hex" "$detail" "$shown"
}

cd -P -- "$scratch"
# NUL-separated, so no name can split or merge entries.
find . -path ./out -prune -o -print0 | LC_ALL=C sort -z > "$listing"
while IFS= read -r -d '' path; do
  describe "$path" || exit 1
done < "$listing" > "$partial"
mv -- "$partial" "$manifest"
echo "$manifest"
