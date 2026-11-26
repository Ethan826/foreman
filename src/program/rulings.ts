// The owner's rulings (v0.2.0 design, "Commands and events", "Closing
// after overrules"): `ruling add --text <t> [--supersedes <id>]` and
// `overrule <findingId> --note <reason>`. Like `reject`, each takes the
// lock, reads the log, asks the command rules and appends one batch; it
// launches nothing, reads no HEAD and stages nothing. `ruling add`
// appends [`RulingAdded`]. `overrule` appends [`RulingAdded`,
// `FindingOverruled`] for a finding of the review awaiting its handoff,
// the ruling's text quoting the finding's summary and the owner's note.
// Ruling ids are `R1`, `R2`, ... in session order, counting both kinds.
import { Effect, Option } from "effect"
import { FindingOverruled, RulingAdded } from "../domain/events.ts"
import type { RulingId } from "../domain/ids.ts"
import { AddRuling, Overrule } from "../domain/session.ts"
import { nextRulingId, overruleText, recordedFinding } from "../features/rulings.ts"
import { openSessionOf } from "../features/session-phases.ts"
import { foldSession } from "../features/session.ts"
import { ownerChecks, readLog, requireAllowed } from "./command-start.ts"
import { awaitedHandoff } from "./handoff-facts.ts"
import type { SessionContext } from "./session-context.ts"

/** The owner's options for `ruling add`. */
export interface AddRulingOptions {
  /** `--text`: the ruling, kept as given, line breaks included; the CLI refuses an empty or blank one. */
  readonly text: string
  /** `--supersedes`: the earlier ruling this one replaces, if any. */
  readonly supersedes: Option.Option<RulingId>
}

/** The owner's options for `overrule`. */
export interface OverruleOptions {
  /** The finding's id within the review awaiting its handoff. */
  readonly findingId: string
  /** `--note`: why the owner overrules it; the CLI refuses an empty or blank one. */
  readonly note: string
}

/**
 * `ruling add`: in an open session with no incomplete attempt, appends
 * `RulingAdded` with the session's next ruling id. Returns it.
 */
export const addRuling = (context: SessionContext, options: AddRulingOptions) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { capabilities } = context
      yield* capabilities.lock
      const read = yield* readLog(capabilities.log)
      const { state } = foldSession(read.events)
      yield* requireAllowed(new AddRuling({ supersedes: options.supersedes }), state, ownerChecks(false, []))
      const session = yield* Effect.fromOption(openSessionOf(state))
      const added = new RulingAdded({
        sessionId: session.opened.sessionId,
        rulingId: nextRulingId(session),
        text: options.text,
        supersedes: options.supersedes,
      })
      yield* capabilities.log.append(read.position, [added])
      return added
    }),
  )

/**
 * `overrule`: with a review that asked for changes awaiting its handoff,
 * and the finding recorded in it and not yet overruled, appends
 * `RulingAdded` and `FindingOverruled` in one batch. Returns the
 * `FindingOverruled`.
 */
export const overrule = (context: SessionContext, options: OverruleOptions) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { capabilities } = context
      yield* capabilities.lock
      const read = yield* readLog(capabilities.log)
      const { state } = foldSession(read.events)
      yield* requireAllowed(new Overrule({ findingId: options.findingId }), state, ownerChecks(false, []))
      const review = yield* Effect.fromOption(awaitedHandoff(state))
      const { session } = review
      const finding = yield* Effect.fromOption(recordedFinding(session, review.opId, options.findingId))
      const rulingId = nextRulingId(session)
      const { sessionId } = session.opened
      const ruling = new RulingAdded({
        sessionId,
        rulingId,
        text: overruleText(review.opId, finding, options.note),
        supersedes: Option.none(),
      })
      const overruled = new FindingOverruled({
        sessionId,
        reviewOpId: review.opId,
        findingId: finding.id,
        rulingId,
        note: options.note,
      })
      yield* capabilities.log.append(read.position, [ruling, overruled])
      return overruled
    }),
  )
