// The target `status` runs on, and what it found wrong on the way
// (re-review R03; batch review B04 and B05; plan "Commands and their
// prerequisites", AC1). Status never refuses here. A configured layout
// that breaks a rule or cannot be resolved, the default ledger directory
// among its paths when HOME is unset (follow-up review at 3b72efc, finding
// 4), a binding that cannot be read or decoded, and a recorded target
// whose layout breaks a rule are each a finding. Status then runs on the recorded target when a binding is
// recorded, readable and its layout passes; on the configured target when
// none is recorded and the configured layout passes; and otherwise on no
// target, without guessing a replacement. Everything here reads only.
import { Array as Arr, Effect, Option, Result, Schema } from "effect"
import { constant } from "effect/Function"
import { type CanonicalLayout, LayoutRefused } from "../domain/layout.ts"
import { StoreVersionNewer } from "../domain/store-version.ts"
import { TargetBinding, TargetBindingUnreadable, TargetMismatch } from "../domain/target.ts"
import { checkLayout } from "../features/layout.ts"
import { compareTarget } from "../features/target-binding.ts"
import type { ConfigUndecodable, TarlatanConfig } from "../format/tarlatan-config.ts"
import { resolvedLayout } from "./layout.ts"
import { checkedTargetLayout, targetOf } from "./production-target.ts"
import { bindingPath, recordedTarget } from "./target-binding.ts"

/** The configured layout breaks a rule, or a path in it cannot be resolved; `reasons` lists each. */
export class ConfiguredLayoutRefused extends Schema.TaggedClass<ConfiguredLayoutRefused>()("ConfiguredLayoutRefused", {
  reasons: Schema.NonEmptyArray(Schema.String),
}) {}

/**
 * The layout of the target recorded in `binding`, checked with the state
 * directory, breaks a rule or cannot be resolved; `reasons` lists each.
 */
export class RecordedLayoutRefused extends Schema.TaggedClass<RecordedLayoutRefused>()("RecordedLayoutRefused", {
  binding: Schema.String,
  reasons: Schema.NonEmptyArray(Schema.String),
}) {}

/**
 * The ledger at `path` is stamped with format version `found`, below 0,
 * which no tarlatan release writes (owner ruling P2); `reason` says so.
 * Status read none of its rows (owner ruling P6).
 */
export class LedgerVersionInvalid extends Schema.TaggedClass<LedgerVersionInvalid>()("LedgerVersionInvalid", {
  path: Schema.String,
  found: Schema.Int,
  reason: Schema.String,
}) {}

/**
 * One problem status found, reported and never refused: with the
 * configuration, the binding or a layout, or with the shared ledger's
 * format version. A ledger stamped by a newer release is
 * `StoreVersionNewer`, with its `path`, the version `found` and the one
 * `known`; one stamped below 0 is {@link LedgerVersionInvalid}. Either
 * way status read none of the ledger's rows (owner ruling P6).
 */
export const StatusFinding = Schema.Union([
  ConfiguredLayoutRefused,
  TargetBindingUnreadable,
  RecordedLayoutRefused,
  StoreVersionNewer,
  LedgerVersionInvalid,
])
/** One problem status found; see {@link StatusFinding}. */
export type StatusFinding = typeof StatusFinding.Type

/** No target binding is recorded in the state directory. */
export class TargetUnbound extends Schema.TaggedClass<TargetUnbound>()("TargetUnbound", {}) {}

/** The configuration names the target recorded in `binding`. */
export class TargetBound extends Schema.TaggedClass<TargetBound>()("TargetBound", {
  binding: Schema.String,
}) {}

/**
 * A binding file is at `binding`, but it could not be compared with the
 * configuration: the binding is unreadable, or a configured path cannot
 * be resolved. The findings say which.
 */
export class TargetUncompared extends Schema.TaggedClass<TargetUncompared>()("TargetUncompared", {
  binding: Schema.String,
}) {}

/**
 * The state directory's binding against the configuration (batch review
 * B04): none, agreeing, a `TargetMismatch` listing each difference, or not
 * compared.
 */
export const TargetReading = Schema.Union([TargetUnbound, TargetBound, TargetMismatch, TargetUncompared])
/** The binding against the configuration; see {@link TargetReading}. */
export type TargetReading = typeof TargetReading.Type

/** Status ran on the recorded target `binding`. */
export class RecordedInForce extends Schema.TaggedClass<RecordedInForce>()("RecordedInForce", {
  binding: TargetBinding,
}) {}

/** No binding is recorded, so status ran on the configured target `binding`. */
export class ConfiguredInForce extends Schema.TaggedClass<ConfiguredInForce>()("ConfiguredInForce", {
  binding: TargetBinding,
}) {}

/**
 * Status ran on no target: the findings say why. It read no ledger, so
 * the report's holds come from the log alone, and it ran no git command.
 */
export class NoTargetInForce extends Schema.TaggedClass<NoTargetInForce>()("NoTargetInForce", {}) {}

/** The target status ran on; see the module comment. */
export const TargetInForce = Schema.Union([RecordedInForce, ConfiguredInForce, NoTargetInForce])
/** The target status ran on; see {@link TargetInForce}. */
export type TargetInForce = typeof TargetInForce.Type

/** What status settled before reading the state: the findings, the binding's reading and the target in force. */
export interface StatusTarget {
  readonly findings: ReadonlyArray<StatusFinding>
  readonly target: TargetReading
  readonly inForce: TargetInForce
}

/**
 * Settles the target status runs on for `config`, whose layout as
 * written is `layout`, or why its ledger directory could not be settled
 * (see the module comment). Reads only; never fails.
 */
export const statusTarget = (
  config: TarlatanConfig,
  layout: Result.Result<CanonicalLayout, ConfigUndecodable>,
): Effect.Effect<StatusTarget> =>
  Effect.gen(function* () {
    const { stateDir } = config
    const resolved = yield* Effect.result(Effect.flatMap(Effect.fromResult(Result.mapError(layout, ledgerUnresolved)), resolvedLayout))
    const configured = Result.map(resolved, (canonical) => targetOf(config, canonical))
    const configuredUsable = Result.flatMap(resolved, usableTarget(config))
    const recorded = yield* Effect.result(recordedTarget(stateDir))
    const recordedLayout = yield* Effect.result(layoutChecked(stateDir, Result.getOrElse(recorded, noBinding)))
    return {
      findings: Arr.getSomes([
        Option.map(Result.getFailure(configuredUsable), configuredRefused),
        Result.getFailure(recorded),
        Option.map(Result.getFailure(recordedLayout), recordedRefused(stateDir)),
      ]),
      target: targetReading(stateDir, recorded, Result.getSuccess(configured)),
      inForce: inForceOf(Result.flatMap(recorded, keptIfPassed(recordedLayout)), configuredUsable),
    }
  })

/**
 * A configured ledger directory that could not be settled, such as the
 * default with HOME unset, as a layout path that cannot be resolved.
 */
const ledgerUnresolved = (undecodable: ConfigUndecodable): LayoutRefused =>
  new LayoutRefused({ reasons: [`cannot resolve the ledger directory: ${undecodable.reason}`] })

/** No binding to check, for a binding that could not be read. */
const noBinding = (): Option.Option<TargetBinding> => Option.none()

/** The configured target, when its resolved layout `canonical` passes the layout rules. */
const usableTarget = (config: TarlatanConfig) => (canonical: CanonicalLayout) =>
  Result.map(checkLayout(canonical), constant(targetOf(config, canonical)))

/** `value`, when the layout check `checked` passed; otherwise the check's refusal. */
const keptIfPassed =
  (checked: Result.Result<void, LayoutRefused>) =>
  <A>(value: A): Result.Result<A, LayoutRefused> =>
    Result.map(checked, constant(value))

/** The layout of the recorded target `bound`, if any, checked with `stateDir`; nothing to check passes. */
const layoutChecked = (stateDir: string, bound: Option.Option<TargetBinding>) =>
  Option.match(bound, {
    onNone: () => Effect.void,
    onSome: (binding) => Effect.asVoid(checkedTargetLayout(stateDir, binding)),
  })

/** The configured layout's refusal as a finding. */
const configuredRefused = (refused: LayoutRefused): StatusFinding => new ConfiguredLayoutRefused({ reasons: refused.reasons })

/** The recorded layout's refusal as a finding naming the binding. */
const recordedRefused = (stateDir: string) => (refused: LayoutRefused): StatusFinding =>
  new RecordedLayoutRefused({ binding: bindingPath(stateDir), reasons: refused.reasons })

/** The binding against the configured target, when both could be read. */
const targetReading = (
  stateDir: string,
  recorded: Result.Result<Option.Option<TargetBinding>, TargetBindingUnreadable>,
  configured: Option.Option<TargetBinding>,
): TargetReading =>
  Result.match(recorded, {
    onFailure: (unreadable) => new TargetUncompared({ binding: unreadable.binding }),
    onSuccess: Option.match({
      onNone: () => new TargetUnbound(),
      onSome: (bound) => comparedWith(stateDir, bound, configured),
    }),
  })

/** The recorded target `bound` compared with the configured one, if that could be resolved. */
const comparedWith = (stateDir: string, bound: TargetBinding, configured: Option.Option<TargetBinding>) =>
  Option.match(configured, {
    onNone: () => new TargetUncompared({ binding: bindingPath(stateDir) }),
    onSome: (target) =>
      Result.match(compareTarget(bindingPath(stateDir), bound, target), {
        onSuccess: () => new TargetBound({ binding: bindingPath(stateDir) }),
        onFailure: (mismatch) => mismatch,
      }),
  })

/**
 * The recorded target when one is readable and its layout passes; the
 * configured one when none is recorded and the configured layout passes;
 * otherwise none. `recorded` fails when the binding is unreadable or its
 * layout is refused.
 */
const inForceOf = (
  recorded: Result.Result<Option.Option<TargetBinding>, TargetBindingUnreadable | LayoutRefused>,
  configured: Result.Result<TargetBinding, LayoutRefused>,
): TargetInForce =>
  Result.match(recorded, {
    onFailure: () => new NoTargetInForce(),
    onSuccess: Option.match({
      onSome: (binding) => new RecordedInForce({ binding }),
      onNone: () => configuredInForce(configured),
    }),
  })

/** The configured target in force, when its layout resolved and passed. */
const configuredInForce = (configured: Result.Result<TargetBinding, LayoutRefused>): TargetInForce =>
  Result.match(configured, {
    onFailure: () => new NoTargetInForce(),
    onSuccess: (binding) => new ConfiguredInForce({ binding }),
  })
