// A Claude run refused by a rate limit. The `rate_limit_event` has the
// shape live test L1 recorded, with status `rejected`; no rate-limited
// run has been recorded, so the error result's subtype is constructed,
// not observed. Classification reads no rate limit from the events yet
// (step-outcome.ts), so the run is `Unclassified`.
import { exitedWith, type ClientScript } from "./fake-client.ts"

/** A rejected rate-limit event, then an error result, and exit code 1. */
export const claudeRateLimited: ClientScript = {
  lines: [
    '{"subtype": "init", "type": "system", "claude_code_version": "2.1.328", "model": "claude-opus-5-5"}',
    '{"type": "rate_limit_event", "rate_limit_info": {"status": "rejected", "rateLimitType": "five_hour", "unifiedWindows": {"five_hour": {"resetsAt": 1794872400, "status": "rejected", "utilization": 1}}}}',
    '{"type": "result", "subtype": "error_during_execution", "is_error": true}',
  ],
  exit: exitedWith(1),
}
