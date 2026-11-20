// The handoff commands as the refusal tests run them, with or without the
// owner's `--attest`; the findings file is the owner's copy of the draft.
import { Effect } from "effect"
import { correct } from "../../src/program/correct.ts"
import { closeFinished } from "../../src/program/handoff.ts"
import { review } from "../../src/program/review.ts"
import { ownerFindings } from "./handoff-steps.ts"
import type { Harness } from "./session-harness.ts"

/** `review --waive` without `--attest`. */
export const unattestedReview = (harness: Harness) => review(harness.context, { waive: true, attest: false })

/** `correct` of the owner's findings without `--attest`. */
export const unattestedCorrect = (harness: Harness) =>
  Effect.flatMap(ownerFindings(harness), (findingsFile) =>
    correct(harness.context, { findingsFile, waive: false, attest: false }),
  )

/** `review --waive --attest`. */
export const attestedReview = (harness: Harness) => review(harness.context, { waive: true, attest: true })

/** `correct --attest` of the owner's findings. */
export const attestedCorrect = (harness: Harness) =>
  Effect.flatMap(ownerFindings(harness), (findingsFile) =>
    correct(harness.context, { findingsFile, waive: false, attest: true }),
  )

/** `session close --finished --attest`. */
export const attestedClose = (harness: Harness) => closeFinished(harness.context, { note: "", attest: true })
