// The exact brief of each attempt (review item B14): the brief's bytes
// are published as `<sessionId>.<opId>.brief.md` before batch I, batch I
// records their path and SHA-256 in `BriefRecorded`, and the client's
// argv carries exactly those bytes. The record survives a restart. A
// failed publication writes no batch I and launches nothing. A brief
// missing or changed later makes the session's handoffs refuse, as a
// missing report does.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Effect, Option, Schema } from "effect"
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import { BriefRecorded, Intended, Launched, LogPosition, ProjectLogError } from "../../src/domain/events.ts"
import { utf8Bytes } from "../../src/program/client-output.ts"
import { implement } from "../../src/program/implement.ts"
import { review } from "../../src/program/review.ts"
import { status } from "../../src/program/status.ts"
import { openProjectLog } from "../../src/runtime/project-log.ts"
import { sha256Of, StateFileFailed } from "../../src/runtime/state-files.ts"
import { claudeSuccess } from "../fixtures/clients/claude-success.ts"
import { implemented } from "./handoff-steps.ts"
import { eventsOf, type Harness, logBatch, published, withHarness } from "./session-harness.ts"
import { failsWith, opened, refusedFor } from "./session-steps.ts"

/** The index of the brief in Claude's editing argv: `claude -p <brief> ...`. */
const claudeBriefIndex = 2

/** The brief the fake client received for its first launch, as UTF-8 byte values. */
const receivedBrief = (harness: Harness) =>
  Effect.map(utf8Bytes(harness.client.launches[0]?.argv[claudeBriefIndex] ?? ""), (bytes) => Array.from(bytes))

/** The `BriefRecorded` events in the log. */
const briefsOf = (harness: Harness) => Effect.map(eventsOf(harness), Arr.filter(Schema.is(BriefRecorded)))

const recordsBeforeBatchI = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    yield* implement(harness.context, { waive: false })
    const [brief] = yield* briefsOf(harness)
    const [intent] = Arr.filter(yield* eventsOf(harness), Schema.is(Intended))
    expect(brief?.opId).toBe(intent?.opId)
    expect(brief?.briefPath).toMatch(/\.brief\.md$/)
    const bytes = readFileSync(brief?.briefPath ?? "")
    expect(sha256Of(bytes)).toBe(brief?.briefSha256)
    expect(Array.from(bytes)).toEqual(yield* receivedBrief(harness))
    expect(harness.trace.slice(1, 3)).toMatchObject([published("\\.brief\\.md"), logBatch("Intended", "BriefRecorded")])
  })

const survivesRestart = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    harness.inject.appendFails = Option.some((events) =>
      events.some(Schema.is(Launched)) ? Option.some(new ProjectLogError({ reason: "crash" })) : Option.none(),
    )
    yield* Effect.exit(implement(harness.context, { waive: false }))
    expect(harness.client.launches).toHaveLength(1)
    const reopened = yield* openProjectLog(`${harness.dir}/log.sqlite`, 50)
    const events = Arr.map(yield* reopened.readFrom(LogPosition.make(0)), (entry) => entry.event)
    const [brief] = Arr.filter(events, Schema.is(BriefRecorded))
    const bytes = readFileSync(brief?.briefPath ?? "")
    expect(sha256Of(bytes)).toBe(brief?.briefSha256)
    expect(Array.from(bytes)).toEqual(yield* receivedBrief(harness))
  })

const publicationFailure = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    harness.inject.publishFails = Option.some((path) => path.endsWith(".brief.md"))
    failsWith(yield* Effect.exit(implement(harness.context, { waive: false })), Schema.is(StateFileFailed))
    expect(Arr.filter(yield* eventsOf(harness), Schema.is(Intended))).toEqual([])
    expect(yield* briefsOf(harness)).toEqual([])
    expect(harness.client.launches).toEqual([])
  })

const changedBriefRefuses = (change: (path: string) => void) => (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    yield* implemented(harness, claudeSuccess)
    const [brief] = yield* briefsOf(harness)
    change(brief?.briefPath ?? "")
    yield* refusedFor(harness, review(harness.context, { waive: true, attest: true }), ["ReportsNotIntact"])
    expect((yield* status(harness.status)).briefs).toEqual([{ opId: brief?.opId, briefIntact: false }])
    expect(harness.gitCalls).toEqual([])
  })

describe("the attempt's brief", () => {
  it.effect("is published before batch I, recorded in it, and is the argv the client received", () =>
    withHarness({}, recordsBeforeBatchI),
  )
  it.effect("is recorded durably when the command stops after the launch", () => withHarness({}, survivesRestart))
  it.effect("that cannot be published stops the command before batch I, launching nothing", () =>
    withHarness({}, publicationFailure),
  )
  it.effect("missing later makes a handoff refuse as a missing report does", () =>
    withHarness({}, changedBriefRefuses((path) => {
      rmSync(path, { recursive: false, force: false })
    })),
  )
  it.effect("changed later makes a handoff refuse as a changed report does", () =>
    withHarness({}, changedBriefRefuses((path) => {
      writeFileSync(path, "another brief\n")
    })),
  )
})
