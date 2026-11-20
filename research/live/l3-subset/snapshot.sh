#!/bin/bash
# L3 subset: write a manifest of everything setup.sh created, so two
# snapshots taken around a client run show every path the run changed.
# Runs no agent client and changes nothing outside <scratch-dir>/out.
#
# Usage: snapshot.sh <scratch-dir> <label>
# Writes <scratch-dir>/out/snap-<label>.txt: one line per path, sorted,
# with the file type, the permission bits and the SHA-256 of the content
# (or the target of a symbolic link). Compare two with diff.
set -eu

if [ $# -ne 2 ]; then
  echo "usage: snapshot.sh <scratch-dir> <label>" >&2
  exit 2
fi
scratch=$(cd "$1" && pwd -P)
label=$2
case "$label" in
  *[!A-Za-z0-9._-]*|"") echo "snapshot.sh: label must be [A-Za-z0-9._-]+" >&2; exit 2 ;;
esac
if [ ! -f "$scratch/.l3-setup-done" ]; then
  echo "snapshot.sh: no completed L3 setup in $scratch" >&2
  exit 2
fi
mkdir -p "$scratch/out"
manifest="$scratch/out/snap-$label.txt"

describe() {
  path=$1
  rel=${path#"$scratch"/}
  mode=$(stat -f %Lp "$path")
  if [ -L "$path" ]; then
    printf 'link %s %s -> %s\n' "$mode" "$rel" "$(readlink "$path")"
  elif [ -f "$path" ]; then
    printf 'file %s %s %s\n' "$mode" "$rel" "$(shasum -a 256 < "$path" | cut -d' ' -f1)"
  elif [ -d "$path" ]; then
    printf 'dir  %s %s\n' "$mode" "$rel"
  else
    printf 'other %s %s\n' "$mode" "$rel"
  fi
}

{
  for name in owner remote.git state outside www home claude-settings.json; do
    if [ -e "$scratch/$name" ] || [ -L "$scratch/$name" ]; then
      find "$scratch/$name" -print | LC_ALL=C sort | while IFS= read -r path; do
        describe "$path"
      done
    else
      printf 'missing %s\n' "$name"
    fi
  done
} > "$manifest"
echo "$manifest"
