// The configuration and the target binding decode strictly (review
// finding R04; focused review finding 3). A path holding the byte FF is
// not UTF-8, and it is refused rather than read with U+FFFD in its place:
// the configuration with `FileNotUtf8`, the binding with
// `TargetBindingUnreadable`, which `status` reports as a finding. A path
// that genuinely holds U+FFFD, encoded as UTF-8, is an ordinary path.
import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { readFileSync, renameSync, writeFileSync } from "node:fs"
import { utf8Bytes } from "../../src/program/client-output.ts"
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

/** Stands for the byte FF until the text is encoded. */
const marker = "@FF@"

/** `text` as UTF-8 bytes with the byte FF where {@link marker} stands. */
const withByteFF = (text: string) =>
  Effect.gen(function* () {
    const [before = "", after = ""] = text.split(marker)
    return new Uint8Array([...(yield* utf8Bytes(before)), 0xff, ...(yield* utf8Bytes(after))])
  })

/** The state directory's target binding. */
const bindingOf = (layout: Layout) => `${layout.state}/target-binding.json`

/** The exit status and the error tag of one run. */
const refusal = (run: CliRun) => [run.status, failureTag(run)]

/** What `status` printed: its findings. */
const Shown = Schema.Struct({ findings: Schema.Array(Schema.Struct({ _tag: Schema.String, reason: Schema.String })) })

const configRefused = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      const text = JSON.stringify(configOf(layout, { ownerCheckout: `${layout.owner}${marker}` }))
      writeFileSync(layout.configPath, yield* withByteFF(text))
      const runs = [
        yield* cli(layout, ["worktree", "create"]),
        yield* cli(layout, ["status"]),
        yield* cli(layout, ["session", "close", "--abandoned"]),
      ]
      expect(runs.map(refusal)).toEqual(runs.map(() => [1, "FileNotUtf8"]))
    }),
  )

const bindingRefused = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* openedSession(layout)
      const recorded = readFileSync(bindingOf(layout), "utf8")
      const damaged = recorded.replace(JSON.stringify(layout.owner), JSON.stringify(`${layout.owner}${marker}`))
      expect(damaged).not.toBe(recorded)
      writeFileSync(bindingOf(layout), yield* withByteFF(damaged))
      const runs = [
        yield* cli(layout, ["implement", "--waive"]),
        yield* cli(layout, ["session", "close", "--abandoned"]),
      ]
      expect(runs.map(refusal)).toEqual(runs.map(() => [1, "TargetBindingUnreadable"]))
      const status = yield* cli(layout, ["status"])
      expect(status.status).toBe(0)
      const shown = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Shown))(status.out.join("\n"))
      expect(shown.findings).toEqual([{ _tag: "TargetBindingUnreadable", reason: "not valid UTF-8" }])
    }),
  )

const genuineReplacementCharacter = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      const owner = `${layout.root}/owner-\uFFFD`
      renameSync(layout.owner, owner)
      writeFileSync(layout.configPath, JSON.stringify(configOf(layout, { ownerCheckout: owner })))
      yield* succeeded(layout, ["worktree", "create"])
      yield* succeeded(layout, ["session", "open", "--tranche", "t-1", "--task", layout.taskFile])
      expect(readFileSync(bindingOf(layout), "utf8")).toContain(JSON.stringify(owner))
      const closed = yield* cli(layout, ["session", "close", "--abandoned"])
      expect(closed.status).toBe(0)
    }),
  )

describe("the configuration and the binding decode strictly", () => {
  it.effect("a configured path holding the byte FF is refused", configRefused, endToEndMillis)
  it.effect("a recorded path holding the byte FF is refused, and status reports it", bindingRefused, endToEndMillis)
  it.effect("a path holding a genuine U+FFFD is an ordinary path", genuineReplacementCharacter, endToEndMillis)
})
