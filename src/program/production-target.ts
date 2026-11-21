// The target a production command runs on (batch review B04, B05 and
// B09): the configuration decoded, the ledger's directory settled, the
// layout resolved and checked, and the target settled against the state
// directory's binding by the command's policy (target-binding.ts). The
// layout of the target in force is checked again, since a reachable
// command may run on a recorded target that differs from the configured
// one. All of this runs before any store is opened, any directory made or
// any git command run. The owner's exits settle theirs with `exitTarget`,
// which consults the binding before the configured layout.
import { Effect, Option, String } from "effect"
import type { CanonicalLayout } from "../domain/layout.ts"
import type { TargetBinding } from "../domain/target.ts"
import { decodeForemanConfig, type ForemanConfig, ledgerDirOf, ledgerFileName } from "../format/foreman-config.ts"
import { stateFiles } from "../runtime/state-files.ts"
import { utf8Text } from "./client-output.ts"
import { checkedLayout } from "./layout.ts"
import { recordedTarget, type TargetPolicy } from "./target-binding.ts"

/** The decoded configuration and the target in force. */
export interface SettledTarget {
  readonly config: ForemanConfig
  readonly target: TargetBinding
}

/** The ledger file's suffix after its directory: `/ledger.sqlite`. */
const ledgerSuffix = `/${ledgerFileName}`

/**
 * Reads the configuration at `configPath`, settles the ledger's directory
 * (`environment` supplies `HOME` for the default) and checks the
 * configured layout. Returns the configuration and the configured target,
 * canonical. Reads only. Fails with `ConfigUndecodable` or
 * `LayoutRefused`, among others.
 */
export const configuredTarget = (configPath: string, environment: Readonly<Record<string, string | undefined>>) =>
  Effect.gen(function* () {
    const { config, layout } = yield* decodedConfiguration(configPath, environment)
    return { config, configured: targetOf(config, yield* checkedLayout(layout)) }
  })

/**
 * Reads the configuration at `configPath` and settles the ledger's
 * directory (`environment` supplies `HOME` for the default). Returns the
 * configuration and its layout as written, unresolved and unchecked.
 * Reads only. Fails with `ConfigUndecodable`, among others.
 */
export const decodedConfiguration = (
  configPath: string,
  environment: Readonly<Record<string, string | undefined>>,
) =>
  Effect.gen(function* () {
    const config = yield* Effect.fromResult(decodeForemanConfig(yield* utf8Text(yield* stateFiles.read(configPath))))
    const ledgerDir = yield* Effect.fromResult(ledgerDirOf(config, Option.fromNullishOr(environment.HOME)))
    const layout: CanonicalLayout = {
      stateDir: config.stateDir,
      ownerCheckout: config.ownerCheckout,
      supervisor: config.supervisor.path,
      ledgerDir,
    }
    return { config, layout }
  })

/** The target `config` names, with the canonical paths of its resolved layout `canonical`. */
export const targetOf = (config: ForemanConfig, canonical: CanonicalLayout): TargetBinding => ({
  projectId: config.projectId,
  ownerCheckout: canonical.ownerCheckout,
  supervisor: { path: canonical.supervisor, name: config.supervisor.name },
  ledger: `${canonical.ledgerDir}${ledgerSuffix}`,
  attributeAllowance: config.attributeAllowance,
})

/**
 * The layout of `target`, the target in force, checked with the state
 * directory `stateDir`: a reachable command may run on a recorded target
 * that differs from the configured one. Fails with `LayoutRefused`.
 */
export const checkedTargetLayout = (stateDir: string, target: TargetBinding) =>
  checkedLayout({
    stateDir,
    ownerCheckout: target.ownerCheckout,
    supervisor: target.supervisor.path,
    ledgerDir: String.slice(0, String.length(target.ledger) - String.length(ledgerSuffix))(target.ledger),
  })

/**
 * Reads the configuration at `configPath` and settles the target under
 * `policy`; `environment` supplies `HOME` for the default ledger
 * directory. Fails with `ConfigUndecodable`, `LayoutRefused`,
 * `TargetMismatch` or `TargetBindingUnreadable`, among others.
 */
export const settledTarget = (
  policy: TargetPolicy,
  configPath: string,
  environment: Readonly<Record<string, string | undefined>>,
) =>
  Effect.gen(function* () {
    const { config, configured } = yield* configuredTarget(configPath, environment)
    const target = yield* policy(config.stateDir, configured)
    yield* checkedTargetLayout(config.stateDir, target)
    return { config, target } satisfies SettledTarget
  })

/**
 * The target the owner's exits run on, for the configuration at
 * `configPath` (plan "Commands and their prerequisites", AC1; focused
 * review finding 2). The recorded target when a binding is recorded,
 * whatever the configured layout says, as `status` runs; otherwise the
 * configured target, whose layout is then checked. The layout of the
 * target in force is checked with the state directory, so an exit never
 * writes through a refused layout. Records nothing. Fails with
 * `ConfigUndecodable`, `TargetBindingUnreadable` or `LayoutRefused`,
 * among others.
 */
export const exitTarget = (configPath: string, environment: Readonly<Record<string, string | undefined>>) =>
  Effect.gen(function* () {
    const { config, layout } = yield* decodedConfiguration(configPath, environment)
    const recorded = yield* recordedTarget(config.stateDir)
    const target = yield* Option.match(recorded, {
      onSome: Effect.succeed,
      onNone: () => Effect.map(checkedLayout(layout), (canonical) => targetOf(config, canonical)),
    })
    yield* checkedTargetLayout(config.stateDir, target)
    return { config, target } satisfies SettledTarget
  })
