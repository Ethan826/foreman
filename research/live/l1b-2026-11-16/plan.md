# L1b sample: plan, recorded before execution

Approved by the owner on 2026-11-16: one Claude implementation step on a
small, concrete task in a disposable repository, bracketed by up to two
`/usage` invocations. Limits: at most 10 turns or 10 minutes; no
subagents; no automatic retries; no push; no changes outside the
disposable repository. The result is one noisy sample. It is not a
measure of per-step usage in general and sets no bound for later steps.

## Disposable repository

A new directory in the session's private scratch space, outside this
repository, with `git init` and one file, `slug.py`, containing a stub:

    def slugify(text: str) -> str:
        raise NotImplementedError

## Task given to the client

    Implement slugify in slug.py: lowercase the text, replace each run of
    characters that are not ASCII letters or digits with a single hyphen,
    and strip leading and trailing hyphens. Then create test_slug.py with
    plain assert statements covering "Hello, World!" -> "hello-world",
    "  a--b  " -> "a-b" and "" -> "", ending with print("ok"), and run it
    with python3 test_slug.py. Change only files in this directory.

## Commands, in order, each run from the disposable repository

1. `claude -p "/usage" --output-format json` (reading before)
2. `timeout 600 claude -p "<task above>" --output-format stream-json
   --verbose --max-turns 10 --allowedTools "Read Edit Write
   Bash(python3 test_slug.py)" --disallowedTools "Task Agent"`
3. `claude -p "/usage" --output-format json` (reading after)

No bypass permission flag is used. If command 2 fails before any request
reaches the provider, it is not retried automatically; an uncertain
outcome is reported as it is. Raw outputs stay private; a whitelisted
copy is inspected before it is committed.
