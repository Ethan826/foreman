// A Codex review that requests changes with two findings, the second
// without a file (v0.2.0, dogfood-6), so a test can see that the findings
// recorded in the log keep the reviewer's order, which is not the ids'
// ascending order, and an absent file. Also
// the repeated-id variant, whose block a decoder must refuse.
import { codexReview } from "./codex-events.ts"

/**
 * The review's final message, with findings F2 (with a file) and then F1
 * (without one): the ids are not in ascending order, so a recorder that
 * sorted them would show.
 */
export const twoFindingsReviewMessage =
  "Two problems.\n\n```json\n" +
  "[\n" +
  '  {"id": "F2", "severity": "major", "file": "greeting.txt", "summary": "The greeting lacks a name."},\n' +
  '  {"id": "F1", "severity": "minor", "summary": "The task asks for a period at the end."}\n' +
  "]\n" +
  "```\n"

/** A review with two findings: `ChangesRequested`. */
export const codexReviewTwoFindings = codexReview(twoFindingsReviewMessage)

/** A final message whose findings block gives two findings the id F1. */
export const repeatedIdReviewMessage =
  "Two problems.\n\n```json\n" +
  "[\n" +
  '  {"id": "F1", "severity": "major", "file": "greeting.txt", "summary": "The greeting lacks a name."},\n' +
  '  {"id": "F1", "severity": "minor", "summary": "The task asks for a period at the end."}\n' +
  "]\n" +
  "```\n"

/** A review whose findings block repeats an id: `Unclassified`. */
export const codexReviewRepeatedId = codexReview(repeatedIdReviewMessage)
