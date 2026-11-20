// The target binding's two uses (batch review B04). A command that acts
// on the target records the binding at first use and refuses a
// configuration that names another target, before any store is opened,
// any client starts or any git command runs. `status`, `step-ended` and
// `session close --abandoned | --interrupted` stay reachable under a
// mismatch: they use the recorded target instead of the configured one,
// and they never record a binding.
import { Effect, Option, Random } from "effect"
import { type TargetBinding, TargetBindingUnreadable } from "../domain/target.ts"
import { compareTarget } from "../features/target-binding.ts"
import { decodeTargetBinding, encodeTargetBinding } from "../format/target-binding.ts"
import { createExclusive, readIfPresent } from "../runtime/binding-file.ts"
import type { StateFileFailed } from "../runtime/state-files.ts"
import { utf8Bytes, utf8Text } from "./client-output.ts"

/** How a command settles its target from the recorded and the configured binding. */
export type TargetPolicy = (stateDir: string, configured: TargetBinding) => Effect.Effect<TargetBinding, unknown>

/** The random part of a temporary file's name is below this bound (2^31). */
const nonceBound = 2_147_483_648

/** Where the binding lives in the state directory `stateDir`. */
export const bindingPath = (stateDir: string): string => `${stateDir}/target-binding.json`

/**
 * For a command that acts on the target: the configured target, after
 * recording it when nothing is recorded, or after checking it against the
 * record. Fails with `TargetMismatch` when they differ, and with
 * `TargetBindingUnreadable` when the record cannot be read or decoded.
 */
export const requireBound: TargetPolicy = (stateDir, configured) =>
  Effect.gen(function* () {
    const recorded = yield* recordedTarget(stateDir)
    const target = Option.isSome(recorded) ? recorded.value : yield* recordedOnce(stateDir, configured)
    yield* Effect.fromResult(compareTarget(bindingPath(stateDir), target, configured))
    return configured
  })

/**
 * For the commands that stay reachable: the recorded target when there is
 * one, else the configured one. Records nothing.
 */
export const recordedOrConfigured: TargetPolicy = (stateDir, configured) =>
  Effect.map(recordedTarget(stateDir), Option.getOrElse(() => configured))

/** The recorded binding, if any. */
const recordedTarget = (stateDir: string) =>
  Effect.gen(function* () {
    const path = bindingPath(stateDir)
    const bytes = yield* Effect.mapError(readIfPresent(path), fileFailed(path))
    if (Option.isNone(bytes)) return Option.none<TargetBinding>()
    const text = yield* utf8Text(bytes.value)
    return Option.some(yield* Effect.mapError(Effect.fromResult(decodeTargetBinding(text)), undecodable(path)))
  })

/**
 * Records `configured` unless another command recorded a binding first;
 * returns whichever binding is recorded, so a lost race is compared too.
 */
const recordedOnce = (stateDir: string, configured: TargetBinding) =>
  Effect.gen(function* () {
    const path = bindingPath(stateDir)
    const nonce = yield* Random.nextIntBetween(0, nonceBound)
    const bytes = yield* utf8Bytes(encodeTargetBinding(configured))
    const created = yield* Effect.mapError(createExclusive(path, `${path}.${String(nonce)}.tmp`, bytes), fileFailed(path))
    if (created) return configured
    return yield* Effect.flatMap(recordedTarget(stateDir), Effect.fromOption)
  })

/** A read or write failure of the binding at `path`. */
const fileFailed = (path: string) => (failure: StateFileFailed) =>
  new TargetBindingUnreadable({ binding: path, reason: failure.reason })

/** A binding at `path` that does not decode; `reason` is the decoder's message. */
const undecodable = (path: string) => (reason: string) => new TargetBindingUnreadable({ binding: path, reason })
