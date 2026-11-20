// A reviewer's findings (plan "Outcomes and usable attempts", decision
// P8): the reviewer ends its final message with a fenced JSON block that
// lists them. An empty list means the review asks for no changes; a
// missing or malformed block makes the step `Unclassified`. The owner
// edits a draft of them into the findings file a correction receives.
import { Schema } from "effect"

const nonEmpty = Schema.String.check(Schema.isNonEmpty())

/**
 * One finding: the reviewer's `id` for it, its `severity` as the reviewer
 * wrote it, the `file` it concerns when it concerns one, and a `summary`.
 * Every text is non-empty. Severity is free text: the plan names no set
 * of severities, and the owner reads it in the draft.
 */
export const Finding = Schema.Struct({
  id: nonEmpty,
  severity: nonEmpty,
  file: Schema.OptionFromOptionalKey(nonEmpty),
  summary: nonEmpty,
})
/** A finding; see {@link Finding}. */
export type Finding = typeof Finding.Type

/** A review's findings, in the reviewer's order; empty means none. */
export const Findings = Schema.Array(Finding)
/** A review's findings; see {@link Findings}. */
export type Findings = typeof Findings.Type

/** The reviewer's final message holds no fenced block tagged `json`. */
export class NoFindingsBlock extends Schema.TaggedError<NoFindingsBlock>()(
  "NoFindingsBlock",
  {},
) {}

/**
 * The last `json` block in the reviewer's final message is not a list of
 * findings: it is not JSON, or an entry lacks a field or has an empty
 * one. `reason` is the decoder's message.
 */
export class MalformedFindings extends Schema.TaggedError<MalformedFindings>()(
  "MalformedFindings",
  { reason: Schema.String },
) {}
