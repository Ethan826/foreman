// A Codex review that requests no changes: a completed turn, and a final
// message ending in an empty findings block (plan decision P8).
import { codexReview } from "./codex-events.ts"

/** The clean review's final message. */
export const cleanReviewMessage = "The change does what the task asks.\n\n```json\n[]\n```\n"

/** A review with no findings: `Success`. */
export const codexReviewClean = codexReview(cleanReviewMessage)
