// A configuration or a target binding that begins with a UTF-8 byte order
// mark is read as before (focused re-review finding 2): 9fee8a5 accepted
// both. The mark is dropped once, at the start of these two files only;
// bytes that are not UTF-8 are still refused after it.
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { readFileSync, writeFileSync } from "node:fs"
import { utf8Bytes } from "../../src/program/client-output.ts"
import { implementerEnded, interruptedAttempt } from "./interrupted-attempt.ts"
import {
  cli,
  type CliRun,
  configOf,
  endToEndMillis,
  failureTag,
  type Layout,
  openedSession,
  succeeded,
  withLayout,
} from "./production-harness.ts"

/** The UTF-8 byte order mark: EF BB BF. */
const markBytes = [0xef, 0xbb, 0xbf]

/** `text` as UTF-8 bytes after the byte order mark, and `extra` bytes after it all. */
const marked = (text: string, extra: ReadonlyArray<number> = []) =>
  Effect.map(utf8Bytes(text), (bytes) => new Uint8Array([...markBytes, ...bytes, ...extra]))

/** The state directory's target binding. */
const bindingOf = (layout: Layout) => `${layout.state}/target-binding.json`

/** Rewrites the recorded binding with a byte order mark before it. */
const markBinding = (layout: Layout) =>
  Effect.map(marked(readFileSync(bindingOf(layout), "utf8")), (bytes) => {
    writeFileSync(bindingOf(layout), bytes)
  })

/** The exit status and the error tag of one run. */
const outcome = (run: CliRun) => [run.status, run.status === 0 ? "" : failureTag(run)]

const markedConfig = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      writeFileSync(layout.configPath, yield* marked(JSON.stringify(configOf(layout))))
      yield* openedSession(layout)
      const closed = yield* cli(layout, ["session", "close", "--abandoned"])
      expect(outcome(closed)).toEqual([0, ""])
    }),
  )

const markedBindingAbandoned = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* openedSession(layout)
      yield* markBinding(layout)
      yield* succeeded(layout, ["status"])
      const closed = yield* cli(layout, ["session", "close", "--abandoned"])
      expect(outcome(closed)).toEqual([0, ""])
      yield* succeeded(layout, ["session", "open", "--tranche", "t-2", "--task", layout.taskFile])
    }),
  )

const markedBindingInterrupted = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      const attempt = yield* interruptedAttempt(layout)
      yield* markBinding(layout)
      const ended = yield* cli(layout, ["step-ended", attempt.opId, "--grant", attempt.grantId])
      const closed = yield* cli(layout, ["session", "close", "--interrupted"])
      expect([ended, closed].map(outcome)).toEqual([
        [0, ""],
        [0, ""],
      ])
      yield* implementerEnded(layout)
    }),
  )

const invalidAfterMark = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      writeFileSync(layout.configPath, yield* marked(JSON.stringify(configOf(layout)), [0xff]))
      expect(outcome(yield* cli(layout, ["status"]))).toEqual([1, "FileNotUtf8"])
      writeConfigPlain(layout)
      yield* openedSession(layout)
      writeFileSync(bindingOf(layout), yield* marked(readFileSync(bindingOf(layout), "utf8"), [0xff]))
      expect(outcome(yield* cli(layout, ["session", "close", "--abandoned"]))).toEqual([1, "TargetBindingUnreadable"])
    }),
  )

/** Writes the layout's configuration without a mark. */
const writeConfigPlain = (layout: Layout) => {
  writeFileSync(layout.configPath, JSON.stringify(configOf(layout)))
}

describe("a leading byte order mark in the configuration or the binding", () => {
  it.effect("a marked configuration opens and closes a session", markedConfig, endToEndMillis)
  it.effect("a marked binding allows status, close --abandoned and the next open", markedBindingAbandoned, endToEndMillis)
  it.live("a marked binding allows step-ended and close --interrupted", markedBindingInterrupted, endToEndMillis)
  it.effect("bytes that are not UTF-8 after the mark are still refused", invalidAfterMark, endToEndMillis)
})
