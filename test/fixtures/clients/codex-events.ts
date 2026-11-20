// The `codex exec --json` events of a completed review, in the shapes live
// test L2 recorded (research/live/l2-2026-11-16/l2-exec.jsonl).
import { exitedWith, type ClientScript } from "./fake-client.ts"

/** The recorded-shape events of a completed turn. */
export const codexCompletedLines: ReadonlyArray<string> = [
  '{"type": "thread.started"}',
  '{"type": "turn.started"}',
  '{"item_type": "agent_message", "type": "item.completed"}',
  '{"type": "turn.completed", "usage": {"input_tokens": 22308, "output_tokens": 5}}',
]

/** A completed review whose final message is `lastMessage`, with exit code 0. */
export const codexReview = (lastMessage: string): ClientScript => ({
  lines: codexCompletedLines,
  exit: exitedWith(0),
  lastMessage,
})
