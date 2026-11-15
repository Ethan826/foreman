#!/bin/sh
# Prose gate: runs tell_lint.py over every Markdown file the repository tracks
# or has not yet ignored, except docs/plans/ and the must-fail fixtures under
# lint-fixtures/prose/. Any blocking finding fails the run. With arguments, it
# checks exactly those files instead (the test uses this on the fixtures).
# A file may have reviewed exceptions in tools/prose/keep/<path with / as _>.json.
set -eu
cd "$(dirname "$0")/../.."

if [ "$#" -gt 0 ]; then
  files=$(printf '%s\n' "$@")
else
  files=$(git ls-files --cached --others --exclude-standard -- '*.md' \
    ':!docs/plans/**' ':!lint-fixtures/prose/**' ':!node_modules/**' | sort -u)
fi

if [ -z "$files" ]; then
  echo "prose: no Markdown files found; refusing to pass on an empty list" >&2
  exit 2
fi

status=0
count=0
for file in $files; do
  count=$((count + 1))
  keep="tools/prose/keep/$(printf '%s' "$file" | tr / _).json"
  if [ -f "$keep" ]; then
    python3 tools/prose/tell_lint.py --keep "$keep" "$file" || status=1
  else
    python3 tools/prose/tell_lint.py "$file" || status=1
  fi
done
echo "prose: checked $count file(s)"
exit "$status"
