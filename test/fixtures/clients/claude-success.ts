// A Claude run that completes: the event shapes recorded by live test L1
// (research/live/l1-2026-11-16/l1-stream.jsonl), ending in a `success`
// result with `is_error` false, and exit code 0.
import { exitedWith, type ClientScript } from "./fake-client.ts"

/** The recorded-shape stream-json of a successful run. */
export const claudeSuccess: ClientScript = {
  lines: [
    '{"subtype": "init", "type": "system", "claude_code_version": "2.1.328", "model": "claude-opus-5-5"}',
    '{"type": "assistant"}',
    '{"type": "rate_limit_event", "rate_limit_info": {"status": "allowed", "unifiedWindows": {"five_hour": {"resetsAt": 1794872400, "status": "allowed", "utilization": 0.05}}}}',
    '{"type": "result", "subtype": "success", "is_error": false, "num_turns": 3, "result": "Done."}',
  ],
  exit: exitedWith(0),
}
