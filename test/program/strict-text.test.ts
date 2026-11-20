// Files whose bytes become text in a launch command (review finding R04):
// Codex's final-message file, the owner's findings file and the session's
// recorded task. Bytes that are not UTF-8 never become U+FFFD. A final
// message that is not UTF-8 makes the review `Unclassified`, and its
// handoff file keeps the exact bytes; a findings file or task that is not
// UTF-8 refuses the command before anything launches.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Effect, Schema } from "effect"
import { readFileSync, writeFileSync } from "node:fs"
import { ReportRecorded, SessionOpened } from "../../src/domain/events.ts"
import { Unclassified } from "../../src/domain/outcomes.ts"
import { correct } from "../../src/program/correct.ts"
import { implement } from "../../src/program/implement.ts"
import { FileNotUtf8, FindingsFileUnreadable } from "../../src/program/session-errors.ts"
import { cleanReviewMessage } from "../fixtures/clients/codex-review-clean.ts"
import { codexCompletedLines } from "../fixtures/clients/codex-events.ts"
import { exitedWith, type ClientScript } from "../fixtures/clients/fake-client.ts"
import { afterFindings, afterImplement, reviewed } from "./handoff-steps.ts"
import { eventsOf, type Harness, withHarness } from "./session-harness.ts"
import { failsWith, opened } from "./session-steps.ts"

/** The flag after which Codex's argv names its final-message file. */
const lastMessageFlag = "--output-last-message"

/** The clean review's final message with the byte FF before its findings block. */
const invalidMessage = (() => {
  const ascii = (text: string) => Array.from(text, (character) => character.charCodeAt(0))
  const [prose, block] = cleanReviewMessage.split("\n\n")
  return new Uint8Array([...ascii(prose ?? ""), 0xff, ...ascii(`\n\n${block ?? ""}`)])
})()

/** A completed Codex turn whose final-message file holds {@link invalidMessage}. */
const invalidReview: ClientScript = {
  lines: codexCompletedLines,
  exit: exitedWith(0),
  alongside: (launch) => {
    writeFileSync(launch.argv[launch.argv.indexOf(lastMessageFlag) + 1] ?? "", invalidMessage)
  },
}

const reviewUnclassified = (harness: Harness) =>
  Effect.gen(function* () {
    yield* afterImplement(harness)
    const recorded = yield* reviewed(harness, invalidReview)
    expect(recorded.outcome).toEqual(new Unclassified())
    const report = yield* Effect.fromOption(Arr.last(Arr.filter(yield* eventsOf(harness), Schema.is(ReportRecorded))))
    expect(Array.from(readFileSync(report.handoffPath))).toEqual(Array.from(invalidMessage))
  })

const findingsRefused = (harness: Harness) =>
  Effect.gen(function* () {
    yield* afterFindings(harness)
    const findingsFile = `${harness.dir}/owner-findings.md`
    writeFileSync(findingsFile, new Uint8Array([0x2d, 0x20, 0xff, 0x0a]))
    failsWith(
      yield* Effect.exit(correct(harness.context, { findingsFile, waive: false, attest: true })),
      Schema.is(FindingsFileUnreadable),
    )
    expect(harness.client.launches).toHaveLength(2)
  })

const taskRefused = (harness: Harness) =>
  Effect.gen(function* () {
    writeFileSync(harness.taskFile, new Uint8Array([0x41, 0xff, 0x0a]))
    yield* opened(harness)
    const sessions = Arr.filter(yield* eventsOf(harness), Schema.is(SessionOpened))
    expect(sessions).toHaveLength(1)
    failsWith(yield* Effect.exit(implement(harness.context, { waive: false })), Schema.is(FileNotUtf8))
    expect(harness.client.launches).toEqual([])
  })

describe("text from file bytes in a launch command", () => {
  it.effect("a final message that is not UTF-8 makes the review Unclassified and keeps its bytes", () =>
    withHarness({ repository: true }, reviewUnclassified),
  )
  it.effect("a findings file that is not UTF-8 refuses the correction", () =>
    withHarness({ repository: true }, findingsRefused),
  )
  it.effect("a task that is not UTF-8 refuses the implementation", () => withHarness({}, taskRefused))
})
