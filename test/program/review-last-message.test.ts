// Codex's final-message file after a review (review item M02): only a
// missing file means the reviewer gave no message, which records an
// empty handoff and an `Unclassified` review. A file that is present but
// cannot be read stops the command before batch F, so no different
// outcome is recorded in its place.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Effect, Schema } from "effect"
import { mkdirSync } from "node:fs"
import { Finished, ReportRecorded } from "../../src/domain/events.ts"
import { StateFileFailed } from "../../src/runtime/state-files.ts"
import { codexCompletedLines } from "../fixtures/clients/codex-events.ts"
import { exitedWith, type ClientScript } from "../fixtures/clients/fake-client.ts"
import { afterImplement, reviewed } from "./handoff-steps.ts"
import { eventsOf, type Harness, withHarness } from "./session-harness.ts"

/** The flag after which Codex's argv names its final-message file. */
const lastMessageFlag = "--output-last-message"

/** A completed Codex turn that writes no final-message file. */
const noMessage: ClientScript = { lines: codexCompletedLines, exit: exitedWith(0) }

/** A completed Codex turn that leaves a directory where its final message should be. */
const unreadableMessage: ClientScript = {
  ...noMessage,
  alongside: (launch) => {
    const path = launch.argv[launch.argv.indexOf(lastMessageFlag) + 1] ?? ""
    mkdirSync(path)
  },
}

const missingIsEmpty = (harness: Harness) =>
  Effect.gen(function* () {
    yield* afterImplement(harness)
    const recorded = yield* reviewed(harness, noMessage)
    expect(recorded.outcome).toMatchObject({ _tag: "Unclassified" })
    const reports = Arr.filter(yield* eventsOf(harness), Schema.is(ReportRecorded))
    expect(Arr.length(reports)).toBe(2)
  })

const unreadableFails = (harness: Harness) =>
  Effect.gen(function* () {
    yield* afterImplement(harness)
    const failure = yield* Effect.flip(reviewed(harness, unreadableMessage))
    expect(Schema.is(StateFileFailed)(failure)).toBe(true)
    const finishes = Arr.filter(yield* eventsOf(harness), Schema.is(Finished))
    expect(Arr.length(finishes)).toBe(1)
  })

describe("review's final-message file", () => {
  it.effect("records an empty handoff when Codex wrote no file", () =>
    withHarness({ repository: true }, missingIsEmpty),
  )
  it.effect("fails, writing no Finished, when the file is present but unreadable", () =>
    withHarness({ repository: true }, unreadableFails),
  )
})
