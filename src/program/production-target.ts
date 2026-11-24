// The target a production command runs on (batch review B04, B05 and
// B09): the configuration decoded, the ledger's directory settled, the
// layout resolved, a recorded binding compared with the configured target
// (owner finding F10, dogfood-2b round 2), the layout rules checked, and
// the target settled against the state directory's binding by the
// command's policy (target-binding.ts). The
// layout of the target in force is checked again, since a reachable
// command may run on a recorded target that differs from the configured
// one. All of this runs before any store is opened, any directory made or
// any git command run, except that production's policy makes a missing
// state directory and ledger directory, both judged first, after the
// configured layout passed and a recorded binding matched, and just before
// it records a first binding (production.ts, store-directory.ts). The
// owner's exits settle theirs with `exitTarget`, which consults the
// binding before the configured layout, after refusing a state directory
// that exists and is not a directory.
import { Effect, Option, Result } from "effect"
import type { CanonicalLayout } from "../domain/layout.ts"
import type { TargetBinding } from "../domain/target.ts"
import { checkLayout } from "../features/layout.ts"
import { parentOf } from "../features/store-directory.ts"
import { decodeTarlatanConfig, type TarlatanConfig, ledgerDirOf, ledgerFileName } from "../format/tarlatan-config.ts"
import { stateFiles } from "../runtime/state-files.ts"
import { strictText } from "./client-output.ts"
import { checkedLayout, resolvedLayout } from "./layout.ts"
import { checkedStoreDirectory } from "./store-directory.ts"
import { matchedRecord, recordedTarget, type TargetPolicy } from "./target-binding.ts"

/** The decoded configuration and the target in force. */
export interface SettledTarget {
  readonly config: TarlatanConfig
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
 * Reads only. Fails with `FileNotUtf8` when the file is not UTF-8, which
 * is never read with U+FFFD in place of its bytes (focused review finding
 * 3), and with `ConfigUndecodable`, among others.
 */
export const decodedConfiguration = (
  configPath: string,
  environment: Readonly<Record<string, string | undefined>>,
) =>
  Effect.gen(function* () {
    const config = yield* readConfiguration(configPath)
    return { config, layout: yield* Effect.fromResult(configuredLayout(config, environment)) }
  })

/**
 * Reads and decodes the configuration at `configPath`, leaving the
 * ledger's directory unsettled, so nothing here needs `HOME` (focused
 * re-review finding 3). Reads only. Fails with `FileNotUtf8` or
 * `ConfigUndecodable`, among others.
 */
export const readConfiguration = (configPath: string) =>
  Effect.flatMap(
    Effect.flatMap(stateFiles.read(configPath), (bytes) => strictText(configPath, bytes)),
    (text) => Effect.fromResult(decodeTarlatanConfig(text)),
  )

/** The target `config` names, with the canonical paths of its resolved layout `canonical`. */
export const targetOf = (config: TarlatanConfig, canonical: CanonicalLayout): TargetBinding => ({
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
    ledgerDir: ledgerDirOfTarget(target),
  })

/**
 * The directory of `target`'s ledger file: the part of its path before
 * the last `/`, so the file's actual parent whatever the recorded file is
 * named (owner finding F8, dogfood-2). The ledger path is absolute: the
 * configured one is canonical, and a recorded binding whose ledger path
 * is not absolute is refused when it is decoded (owner finding F11,
 * format/target-binding.ts), so the result is never `/` for a bare file
 * name. A command that writes the ledger prepares this directory before
 * it opens the ledger (store-directory.ts).
 */
export const ledgerDirOfTarget = (target: TargetBinding): string => parentOf(target.ledger)

/**
 * Reads the configuration at `configPath` and settles the target under
 * `policy`; `environment` supplies `HOME` for the default ledger
 * directory. The configured layout is resolved, an entry at the state
 * directory's resolved path that is not a directory is refused (owner
 * finding F2), and a recorded binding is compared with the configured
 * target before the layout rules are applied, so a changed target fails
 * with `TargetMismatch` even where the layout check would refuse it (owner
 * finding F10, dogfood-2b round 2). The layout rules then run, on first
 * use before `policy` records a binding. All of this reads only. Fails
 * with `ConfigUndecodable`, `StoreDirectoryRefused`, `TargetMismatch`,
 * `TargetBindingUnreadable` or `LayoutRefused`, among others.
 */
export const settledTarget = (
  policy: TargetPolicy,
  configPath: string,
  environment: Readonly<Record<string, string | undefined>>,
) =>
  Effect.gen(function* () {
    const { config, layout } = yield* decodedConfiguration(configPath, environment)
    const canonical = yield* resolvedLayout(layout)
    const configured = targetOf(config, canonical)
    yield* checkedStoreDirectory(config.stateDir)
    yield* matchedRecord(config.stateDir, configured)
    yield* Effect.fromResult(checkLayout(canonical))
    const target = yield* policy(config.stateDir, configured)
    yield* checkedTargetLayout(config.stateDir, target)
    return { config, target } satisfies SettledTarget
  })

/**
 * The target the owner's exits run on, for the configuration at
 * `configPath` (plan "Commands and their prerequisites", AC1; focused
 * review finding 2). The recorded target when a binding is recorded,
 * whatever the configured layout says, as `status` runs; otherwise the
 * configured target, whose layout is then checked. The binding is read
 * before the ledger's directory is settled, so with a binding recorded
 * the default `<HOME>/.tarlatan` is never resolved and `HOME` is not
 * needed (focused re-review finding 3). The layout of the
 * target in force is checked with the state directory, so an exit never
 * writes through a refused layout. Before the binding is read, an entry
 * at the state directory's resolved path that is not a directory is
 * refused with `StoreDirectoryRefused` (owner finding F2, dogfood-2).
 * Records and creates nothing. Fails with `ConfigUndecodable`,
 * `StoreDirectoryRefused`, `TargetBindingUnreadable` or `LayoutRefused`,
 * among others.
 */
export const exitTarget = (configPath: string, environment: Readonly<Record<string, string | undefined>>) =>
  Effect.gen(function* () {
    const config = yield* readConfiguration(configPath)
    yield* checkedStoreDirectory(config.stateDir)
    const recorded = yield* recordedTarget(config.stateDir)
    const target = yield* Option.match(recorded, {
      onSome: Effect.succeed,
      onNone: () => unboundExitTarget(config, environment),
    })
    yield* checkedTargetLayout(config.stateDir, target)
    return { config, target } satisfies SettledTarget
  })

/**
 * The configuration's layout as written, the ledger's directory settled:
 * the configured `ledgerDir`, or the default under `environment`'s `HOME`.
 * Fails with `ConfigUndecodable` when neither is set or the default is
 * not an absolute, normalized path (`ledgerDirOf`).
 */
export const configuredLayout = (config: TarlatanConfig, environment: Readonly<Record<string, string | undefined>>) =>
  Result.map(
    ledgerDirOf(config, Option.fromNullishOr(environment.HOME)),
    (ledgerDir): CanonicalLayout => ({
      stateDir: config.stateDir,
      ownerCheckout: config.ownerCheckout,
      supervisor: config.supervisor.path,
      ledgerDir,
    }),
  )

/** The configured target of an exit with no binding: only here is the default ledger directory needed. */
const unboundExitTarget = (config: TarlatanConfig, environment: Readonly<Record<string, string | undefined>>) =>
  Effect.flatMap(Effect.fromResult(configuredLayout(config, environment)), (layout) =>
    Effect.map(checkedLayout(layout), (canonical) => targetOf(config, canonical)),
  )
