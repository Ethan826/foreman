# Prose gate

`bun run prose` runs `tell_lint.py` over every Markdown file outside `docs/plans/` and `node_modules/`, and fails on any blocking finding. `bun run check` includes it.

`tell_lint.py` and `tell_rules.json` are copied unchanged from the skills repository (github.com/Ethan826/skills), path `skills/humanized-prose-review/scripts/`, commit `a168f79f8be1ef667ce16aa19b028a8d8b110b03`. Updates come from that repository; do not edit the copies here.

`check.sh` builds the file list with `git ls-files`, so a new Markdown file is covered without any change. The must-fail and clean fixtures are in `lint-fixtures/prose/` and are tested by `test/lint/prose.test.ts`.

A reviewed exception for one file goes in `keep/<path with / replaced by _>.json`, with a reason on every entry. The format is described in the skill's `SKILL.md`.
