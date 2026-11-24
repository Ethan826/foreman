// The configuration file and the target binding file may begin with one
// UTF-8 byte order mark (focused re-review finding 2). 9fee8a5 accepted
// both files with or without it; the strict decoder keeps the mark as
// U+FEFF, so each JSON decoder drops exactly one leading U+FEFF itself.
// A second mark, or one anywhere else, is ordinary text: refused before
// the JSON, kept inside a string.
import { describe, expect, it } from "@effect/vitest"
import { Result } from "effect"
import { Clients } from "../../src/domain/clients.ts"
import { ProjectId } from "../../src/domain/ids.ts"
import type { TargetBinding } from "../../src/domain/target.ts"
import { decodeTarlatanConfig } from "../../src/format/tarlatan-config.ts"
import { decodeTargetBinding, encodeTargetBinding } from "../../src/format/target-binding.ts"

/** U+FEFF, the byte order mark once decoded. */
const mark = "﻿"

const config = (ownerCheckout: string) =>
  JSON.stringify({
    projectId: "alpha",
    stateDir: "/state",
    ownerCheckout,
    supervisor: { path: "/state/worktree", name: "assisted" },
    attributeAllowance: { rootLines: [] },
    pins: { [Clients.Claude]: "2.1.328 (Claude Code)", [Clients.Codex]: "codex-cli 0.170.0" },
  })

const binding = (ownerCheckout: string): TargetBinding => ({
  projectId: ProjectId.make("alpha"),
  ownerCheckout,
  supervisor: { path: "/state/worktree", name: "assisted" },
  ledger: "/ledger/ledger.sqlite",
  attributeAllowance: { rootLines: [] },
})

const ownerOf = (text: string) => Result.map(decodeTarlatanConfig(text), (decoded) => decoded.ownerCheckout)

describe("a leading byte order mark", () => {
  it("is accepted at the start of the configuration", () => {
    expect(ownerOf(`${mark}${config("/owner")}`)).toEqual(Result.succeed("/owner"))
  })

  it("is accepted at the start of the binding", () => {
    expect(decodeTargetBinding(`${mark}${encodeTargetBinding(binding("/owner"))}`)).toEqual(
      Result.succeed(binding("/owner")),
    )
  })

  it("is dropped only once: a second mark is refused", () => {
    expect(Result.isFailure(decodeTarlatanConfig(`${mark}${mark}${config("/owner")}`))).toBe(true)
    expect(Result.isFailure(decodeTargetBinding(`${mark}${mark}${encodeTargetBinding(binding("/owner"))}`))).toBe(true)
  })

  it("is not dropped after leading whitespace", () => {
    expect(Result.isFailure(decodeTarlatanConfig(` ${mark}${config("/owner")}`))).toBe(true)
    expect(Result.isFailure(decodeTargetBinding(` ${mark}${encodeTargetBinding(binding("/owner"))}`))).toBe(true)
  })

  it("inside a value stays part of the value", () => {
    expect(ownerOf(`${mark}${config(`/${mark}owner`)}`)).toEqual(Result.succeed(`/${mark}owner`))
    expect(decodeTargetBinding(encodeTargetBinding(binding(`/own${mark}er`)))).toEqual(
      Result.succeed(binding(`/own${mark}er`)),
    )
  })
})
