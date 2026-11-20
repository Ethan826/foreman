// A Codex review whose findings block is not a list of findings: a
// completed turn, but the block's entry lacks its summary, so the review
// is `Unclassified` (plan decision P8) and close-only (decision P11).
import { codexReview } from "./codex-events.ts"

/** The review's final message, with a findings entry that has no summary. */
export const malformedReviewMessage = 'Done.\n\n```json\n[{"id": "F1", "severity": "major"}]\n```\n'

/** A review whose findings block does not decode: `Unclassified`. */
export const codexReviewMalformed = codexReview(malformedReviewMessage)
