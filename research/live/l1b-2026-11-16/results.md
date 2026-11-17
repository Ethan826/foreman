# L1b sample: results

Ran on 2026-11-16 as recorded in `plan.md`, within its limits: three
commands, no retries, no bypass flag, nothing changed outside the
disposable repository. This is one noisy sample. It does not measure
per-step usage in general and sets no bound for later steps.

## What ran

- Disposable repository in the session's private scratch space with a
  stub `slug.py`, committed once.
- `/usage` before (Unix time 1794867591), the step from 1794867600 to
  1794867614 (14 seconds), `/usage` after (1794867621).
- The step: exit 0, 5 turns (limit 10), tools used Bash, Write, Write,
  Bash. It wrote `slugify` and `test_slug.py`, and `python3
  test_slug.py` prints `ok`. No subagent ran.
- The step's `result` reports 6 input tokens, 998 output tokens, 60,429
  cache-read and 16,749 cache-creation tokens, and `total_cost_usd`
  0.166 at list price (the subscription is not billed per call).

## Readings

| Source | Five-hour | Weekly (all models) |
|---|---|---|
| `/usage` before | 13% | 24% |
| Step's own `rate_limit_event` (during the step) | 12% (utilization 0.12) | 24% (0.24) |
| `/usage` after | 13% | 24% |

Neither `/usage` reading moved across the step. Both `/usage` calls
reported 0 turns and 0 tokens.

## How far this sample goes

- Whole-point resolution: a step that used less than one point leaves no
  visible change, so "no change" does not mean "no use".
- The sources disagree: during the step the stream event said 12% while
  `/usage` said 13% before and after. They round or refresh differently,
  so readings from different sources are not interchangeable.
- Concurrent use: a documentation agent and the coordinating session
  were using the same account while this ran.
- Delay: whether either source had counted the step by the after-read is
  unknown.
- The task was deliberately tiny. A real implement step is larger.

## Files

- `plan.md`: task and commands, committed before execution.
- `usage-before.json`, `usage-after.json`: result fields and window lines
  only (time zone redacted).
- `step.jsonl`: event types, tool names, the rate-limit event and the
  result fields only (no message text, session or path fields).
