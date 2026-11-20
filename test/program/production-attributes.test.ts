// Attribute files through the production composition. The configuration
// may enable one line only, Waxwing's `*.wxw linguist-language=Rust`, in
// the root `.gitattributes`, and only for the target it is bound to
// (batch review B06; owner decision M09). After staging, the candidate
// tree's own `.gitattributes` blobs are judged by the same rule, from
// their contents, before any client gets the candidate; and the startup
// check judges the session's base, or the worktree's HEAD before a
// session, not the base the worktree was created at (batch review B07).
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { commitAttributes } from "./attribute-fixtures.ts"
import {
  cli,
  configOf,
  endToEndMillis,
  failureTag,
  type Layout,
  openedSession,
  withLayout,
  writeConfig,
} from "./production-harness.ts"

/** Waxwing's one approved line. */
const waxwingLine = "*.wxw linguist-language=Rust"

/** A configuration whose allowance names `rootLines`. */
const allowing = (layout: Layout, rootLines: ReadonlyArray<string>) =>
  writeConfig(layout, configOf(layout, { attributeAllowance: { rootLines } }))

const configuredLineRefused = (rootLines: ReadonlyArray<string>) => () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      allowing(layout, rootLines)
      const run = yield* cli(layout, ["worktree", "create"])
      expect([run.status, failureTag(run)]).toEqual([1, "ConfigUndecodable"])
    }),
  )

const waxwingLineAllowed = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* commitAttributes(layout.owner, ".gitattributes", `# Waxwing\n${waxwingLine}\n`)
      allowing(layout, [waxwingLine])
      yield* openedSession(layout)
    }),
  )

const waxwingLineRefusedWithoutAllowance = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* commitAttributes(layout.owner, ".gitattributes", `${waxwingLine}\n`)
      const run = yield* cli(layout, ["worktree", "create"])
      expect([run.status, failureTag(run)]).toEqual([1, "AttributeSourcesRefused"])
    }),
  )

const allowanceOnlyForBoundTarget = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* openedSession(layout)
      allowing(layout, [waxwingLine])
      const run = yield* cli(layout, ["implement", "--waive"])
      expect([run.status, failureTag(run)]).toEqual([1, "TargetMismatch"])
    }),
  )

describe("the configured attribute allowance", () => {
  it.effect("a conversion line is refused at decoding", configuredLineRefused(["* text=auto"]), endToEndMillis)
  it.effect("a filter line is refused at decoding", configuredLineRefused(["*.txt filter=evil"]), endToEndMillis)
  it.effect("a macro line is refused at decoding", configuredLineRefused(["[attr]binary -diff -merge -text"]), endToEndMillis)
  it.effect("a near miss of Waxwing's line is refused at decoding", configuredLineRefused([`${waxwingLine} filter=x`]), endToEndMillis)
  it.effect("Waxwing's line twice is refused at decoding", configuredLineRefused([waxwingLine, waxwingLine]), endToEndMillis)
  it.effect("Waxwing's line, when allowed, passes creation and the startup check", waxwingLineAllowed, endToEndMillis)
  it.effect("Waxwing's line is refused without the allowance", waxwingLineRefusedWithoutAllowance, endToEndMillis)
  it.effect("the allowance cannot be enabled for a state directory bound without it", allowanceOnlyForBoundTarget, endToEndMillis)
})
