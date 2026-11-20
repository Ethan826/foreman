// A Codex review that requests changes: a completed turn, and a final
// message ending in a findings block with one finding (plan decision P8).
import { codexReview } from "./codex-events.ts"

/** The review's final message, with one finding about `greeting.txt`. */
export const findingsReviewMessage =
  "One problem.\n\n```json\n" +
  '[{"id": "F1", "severity": "major", "file": "greeting.txt", "summary": "The greeting lacks a name."}]\n' +
  "```\n"

/** A review with one finding: `ChangesRequested`. */
export const codexReviewFindings = codexReview(findingsReviewMessage)
