# L3 subset: production's Claude editing profile, read from the
# repository's own code with bun, sourced by setup.sh and run-case.sh.
# Defines functions only; runs nothing. The package lives at
# research/live/l3-subset, so the repository is three levels up.
#
# The trial runs the exact profile production builds (open question 1 in
# plan.md, ruled 2026-11-21): the settings file comes from
# claudeEditingSettings (src/format/claude-settings.ts) and the argv from
# claudeEditingArgv (src/domain/profiles.ts), whatever they hold when the
# script runs. The package adds only what plan.md lists: Bash(sh check.sh)
# in the settings, and the prompt, the turn cap and the timeout wrapper
# in the argv.

l3_repo="$here/../../.."

# Fails with a message unless the repository's profile code is there.
l3_require_repo() {
  if [ ! -f "$l3_repo/src/format/claude-settings.ts" ] || [ ! -f "$l3_repo/src/domain/profiles.ts" ]; then
    echo "profile.sh: production's profile code is not at $l3_repo/src" >&2
    return 1
  fi
}

# Writes production's settings for the worktree $1, whose own git
# directory is $2 and whose common git directory is $3 (the git identity
# production records; the sandbox denies writes to both, owner ruling of
# 2026-11-23), to the new file $4, with the L3 stand-in for the target's
# test command, Bash(sh check.sh), right after Bash(git diff *) (plan.md,
# "Settings and production"). Fails if production refuses a path, if the
# anchor rule is missing or repeated, if the stand-in is already there, or
# if $4 exists.
l3_production_settings() {
  l3_require_repo || return 1
  l3_rendered=$(cd "$l3_repo" && bun -e '
import { Result } from "effect"
import { claudeEditingSettings } from "./src/format/claude-settings.ts"
const [, path, gitDir, commonDir] = process.argv
const rendered = claudeEditingSettings({ path, gitDir, commonDir }, [])
if (Result.isFailure(rendered)) process.exit(3)
process.stdout.write(rendered.success)
' "$1" "$2" "$3") || return 1
  printf '%s\n' "$l3_rendered" | /usr/bin/python3 -I -c '
import json
import sys

anchor, stand_in = "Bash(git diff *)", "Bash(sh check.sh)"
data = json.load(sys.stdin)
allow = data["permissions"]["allow"]
if allow.count(anchor) != 1 or stand_in in allow:
    sys.exit("profile.sh: production allow list has no single " + anchor + ", or already has " + stand_in)
allow.insert(allow.index(anchor) + 1, stand_in)
with open(sys.argv[1], "x", encoding="utf-8") as target:
    json.dump(data, target, indent=2, ensure_ascii=False)
    target.write("\n")
' "$4"
}

# Writes production's Claude argv for the brief $1 and the settings file
# $2 to the file $3, each argument followed by a NUL byte, so no argument
# can split or merge with another.
l3_production_argv() {
  l3_require_repo || return 1
  (cd "$l3_repo" && bun -e '
import { claudeEditingArgv } from "./src/domain/profiles.ts"
const argv = claudeEditingArgv({ brief: process.argv[1], settingsFile: process.argv[2] })
process.stdout.write(argv.map((part) => `${part}\0`).join(""))
' "$1" "$2") > "$3"
}
