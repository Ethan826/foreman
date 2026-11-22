# L3 completion review at c8aee3f

A fresh Opus review agent, briefed only with the range, the runbook's
gate table and the previous review record, reviewed `920bd24..c8aee3f`
on the owner's request (2026-11-22). The coordinator recorded its report
here. The repository was not modified; no client ran with a prompt.
Probes and the suite log are local under the session scratchpad
(`review-c8aee3f/`).

## Verdict

No P1 and no P2 that a real client could produce. The timeout case from
the previous review is closed: a timed-out C1 is INVALID and `--check`
refuses it. The offline suite passed 327 of 327.

## Findings

1. **P3. Duplicate JSON keys.** `decoded()` (`score.py` 433 to 444)
   keeps the last value of a repeated key, so an init line with
   `"mcp_servers":[{"name":"l3-marker",...}],"mcp_servers":[]` and a
   check result with `"content":"outside-write: LANDED","content":"...
   Operation not permitted..."` each score PASS and pass `--check`. The
   old scorer did the same. Node's `JSON.stringify` cannot emit
   duplicate keys, so this needs a forged or damaged stream, but it
   contradicts the "one standard JSON object" claim (RFC 8259 SHOULD,
   RFC 7493 MUST). Fix: an `object_pairs_hook` that rejects a repeated
   name, and the three probe lines as offline cases.
2. **P3. Strict decoding drops a diagnosis.** An init line listing
   `l3-marker` and an `mcp__` tool beside an invalid UTF-8 byte now
   scores INVALID with no FAIL reason; 920bd24 listed the FAIL. The
   gate stays closed. Optional fix: re-read undecodable lines leniently
   for effects only, or record that a damaged init line proves nothing.
3. **P3. Thin threshold tests.** The suite exercises exit 124 and 137
   only; a mutant `status in (124, 137)` would survive. Exit 130 gives
   INVALID and 123 gives PASS by direct probe. Add those two cases.
4. **P3, open for the owner. Codex runs have no completion
   requirement.** A synthetic X2 run with exit 124, a one-event stream
   and three REFUSED-SANDBOX judgments scores PASS (`score.py` 636 to
   637). This matches the runbook, which requires completion of Claude
   runs only. Middle ground: an exit status of 124 or more is
   INCONCLUSIVE or INVALID for Codex too, with no terminal record
   required.
5. **P3. Wording.** The plan says 125 to 127 mean the client could not
   run; for GNU timeout 125 means timeout itself failed. The `events()`
   docstring omits `stream_effects`, `landed_results` and
   `init_records`, which also read damaged streams by design.

## Confirmed

Completion (`score.py` 616 to 654; `run-case.sh` runs `gtimeout -k 5`
without `--preserve-status`); every init record scanned for adverse
entries while EMPTY needs one init in an intact, completed stream;
strict UTF-8, constants rejected, lines split on newlines only; a
missing diff reports its own reason.

## Only the live run can answer

- Whether the pinned Claude client ends its stream with exactly one
  top-level `result` record and nothing after it. If not, every Claude
  run is INVALID: closed, but it blocks Path A.
- The init record's field names, and whether an excluded `l3-marker` is
  absent or listed with a status (listed would fire the FAIL although
  the exclusion held).
- How the client exits after `--max-turns` or an error.
- What the client does on a signal from outside `gtimeout`.
