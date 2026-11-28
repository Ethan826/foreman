// Shared steps of the handoff Program tests (plan "Slice A2"): Claude
// scripts that edit the worktree, the cycle's commands with the owner's
// usual flags, the object store's size, and reads of the log.
import { expect } from "@effect/vitest"
import { Array as Arr, Effect, Option, Schema } from "effect"
import { readFileSync, writeFileSync } from "node:fs"
import { type ProjectEvent, SessionOpened } from "../../src/domain/events.ts"
import { correct } from "../../src/program/correct.ts"
import { closeFinished, reject } from "../../src/program/handoff.ts"
import { implement } from "../../src/program/implement.ts"
import { review } from "../../src/program/review.ts"
import { claudeSuccess } from "../fixtures/clients/claude-success.ts"
import type { ClientScript } from "../fixtures/clients/fake-client.ts"
import { codexReviewClean } from "../fixtures/clients/codex-review-clean.ts"
import { codexReviewFindings } from "../fixtures/clients/codex-review-findings.ts"
import { git } from "../runtime/git-repo.ts"
import { eventsOf, type Harness } from "./session-harness.ts"
import { opened } from "./session-steps.ts"

/** A successful Claude run that writes `text` to `greeting.txt` and hands off `handoff`. */
export const editing = (text: string, handoff: string): ClientScript => ({
  lines: [
    ...claudeSuccess.lines.slice(0, -1),
    JSON.stringify({ type: "result", subtype: "success", is_error: false, num_turns: 2, result: handoff }),
  ],
  exit: claudeSuccess.exit,
  alongside: (launch) => {
    writeFileSync(`${launch.cwd}/greeting.txt`, text)
  },
})

/** The implementer's edit and handoff in these tests. */
export const implementerEdit = editing("Hello, world.\n", "Wrote the greeting.")

/** Runs `implement` with `script` playing the implementer. */
export const implemented = (harness: Harness, script: ClientScript = implementerEdit, waive = false) =>
  Effect.gen(function* () {
    harness.client.queue.push(script)
    return yield* implement(harness.context, { waive })
  })

/** Runs `review --waive --attest` with `script` playing the reviewer. */
export const reviewed = (harness: Harness, script: ClientScript = codexReviewFindings) =>
  Effect.gen(function* () {
    harness.client.queue.push(script)
    return yield* review(harness.context, { waive: true, attest: true })
  })

/** Where the owner keeps the findings file passed to `correct`. */
export const findingsFileOf = (harness: Harness) => `${harness.dir}/owner-findings.md`

/** Copies the session's findings draft to the owner's findings file, as the owner would. */
export const ownerFindings = (harness: Harness) =>
  Effect.gen(function* () {
    const draft = yield* draftPathOf(harness)
    writeFileSync(findingsFileOf(harness), readFileSync(draft, "utf8"))
    return findingsFileOf(harness)
  })

/** The corrector's edit and handoff in these tests. */
export const correctorEdit = editing("Hello, Ada.\n", "Named Ada.")

/**
 * Runs `correct --findings <owner file> --attest` with `script` playing
 * the corrector, adding `--waive` when the `waive` option is set (off by
 * default).
 */
export const corrected = (
  harness: Harness,
  script: ClientScript = correctorEdit,
  { waive = false }: { readonly waive?: boolean } = {},
) =>
  Effect.gen(function* () {
    const findingsFile = yield* ownerFindings(harness)
    harness.client.queue.push(script)
    return yield* correct(harness.context, { findingsFile, waive, attest: true })
  })

/** Runs `session close --finished --attest`. */
export const finished = (harness: Harness) => closeFinished(harness.context, { note: "done", attest: true })

/** Runs `reject` with a note. */
export const rejected = (harness: Harness) => reject(harness.context, { note: "not this" })

/** Opens a session and runs the implementer. */
export const afterImplement = (harness: Harness) => Effect.andThen(opened(harness), implemented(harness))

/** Opens a session, implements and reviews with findings. */
export const afterFindings = (harness: Harness) => Effect.andThen(afterImplement(harness), reviewed(harness))

/** Opens a session, implements and reviews clean. */
export const afterClean = (harness: Harness) =>
  Effect.andThen(afterImplement(harness), reviewed(harness, codexReviewClean))

/** The session's findings draft: `<stateDir>/<sessionId>.findings-draft.md`. */
export const draftPathOf = (harness: Harness) =>
  Effect.map(sessionIdOf(harness), (sessionId) => `${harness.dir}/${sessionId}.findings-draft.md`)

/** The open session's id, from the log. */
export const sessionIdOf = (harness: Harness) =>
  Effect.flatMap(eventsOf(harness), (events) =>
    Effect.fromOption(Option.map(Arr.findLast(events, Schema.is(SessionOpened)), (opened) => opened.sessionId)),
  )

/** The events in the log that `guard` accepts. */
export const eventsWhere = <A extends ProjectEvent>(harness: Harness, guard: (event: ProjectEvent) => event is A) =>
  Effect.map(eventsOf(harness), (events) => Arr.filter(events, guard))

/** `git count-objects -v` in the worktree: the object store's counts and sizes. */
export const objectCounts = (harness: Harness) => git(harness.worktree.path, "count-objects", "-v")

/** Asserts that `effect` writes no git object and runs no git command. */
export const stagesNothing = (harness: Harness, effect: Effect.Effect<unknown, unknown>) =>
  Effect.gen(function* () {
    const before = yield* objectCounts(harness)
    const callsBefore = harness.gitCalls.length
    yield* Effect.exit(effect)
    expect(yield* objectCounts(harness)).toBe(before)
    expect(harness.gitCalls.length).toBe(callsBefore)
  })

export { commandOf as commandOfCall } from "./session-tracing.ts"
