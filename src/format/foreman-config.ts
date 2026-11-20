// The configuration file (plan "Slice A1", decisions P3 to P5): one JSON
// object naming the project, the state directory, the owner's checkout,
// the supervisor worktree's path and branch name, the root
// `.gitattributes` allowance (decision M09), the client version pins, the
// Claude settings file the editing profile loads, and each role's grant
// estimate. Decoding is strict: an unknown key, a relative path, a missing
// pin or a malformed value refuses the whole file, because a key the
// decoder ignored could be a setting the owner believes is in force.
import { Option, Result, Schema, String } from "effect"
import { AttributeAllowance } from "../domain/attributes.ts"
import { Client } from "../domain/clients.ts"
import { ProjectId } from "../domain/ids.ts"
import { defaultPolicy } from "../domain/policy.ts"
import { Role, Roles } from "../domain/roles.ts"

/** The configuration file could not be decoded; `reason` says where. */
export class ConfigUndecodable extends Schema.TaggedError<ConfigUndecodable>()(
  "ConfigUndecodable",
  { reason: Schema.String },
) {}

/** The most points a grant estimate may reserve: a whole window. */
const wholeWindowPoints = 100

/** An absolute path: non-empty text starting with `/`. */
const AbsolutePath = Schema.String.check(Schema.isPattern(/^\//))

/**
 * The supervisor branch's `<name>` in `foreman/<name>`: letters, digits,
 * dot, underscore and hyphen, 1 to 64 characters, the first a letter or
 * digit, so the branch name needs no quoting.
 */
const BranchName = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/))

/** A client version pin: the client's `--version` output, trimmed (decision P4). */
const Pin = Schema.String.check(Schema.isNonEmpty())

/** A grant estimate in points, 0 to 100 (decision P5). */
const EstimatePoints = Schema.Number.check(
  Schema.isBetween({ minimum: 0, maximum: wholeWindowPoints }),
)

/** Where the supervisor worktree lives and the name of its branch. */
const Supervisor = Schema.Struct({ path: AbsolutePath, name: BranchName })

/** The grant estimate of each role, in points. */
const Estimates = Schema.Record(Role, EstimatePoints)

/** The file as written: `estimates` may be left out. */
const ConfigFile = Schema.Struct({
  projectId: ProjectId,
  stateDir: AbsolutePath,
  ownerCheckout: AbsolutePath,
  supervisor: Supervisor,
  attributeAllowance: AttributeAllowance,
  pins: Schema.Record(Client, Pin),
  claudeSettings: AbsolutePath,
  estimates: Schema.optionalKey(Estimates),
})

/**
 * The decoded configuration. `estimates` holds every role; a file that
 * leaves it out gets the policy's `initialEstimate` for each (decision P5).
 */
export interface ForemanConfig {
  readonly projectId: ProjectId
  /** Holds the log, the ledger, the lock and every published state file. */
  readonly stateDir: string
  /** The owner's checkout, read only when the supervisor worktree is created. */
  readonly ownerCheckout: string
  /** The supervisor worktree's path and the `<name>` of `foreman/<name>`. */
  readonly supervisor: { readonly path: string; readonly name: string }
  readonly attributeAllowance: AttributeAllowance
  /** Each client's pinned `--version` output, trimmed (decision P4). */
  readonly pins: Readonly<Record<Client, string>>
  /** The Claude settings file the editing profile passes with `--settings`. */
  readonly claudeSettings: string
  /** Each role's grant estimate in points (decision P5). */
  readonly estimates: Readonly<Record<Role, number>>
}

const decodeFile = Schema.decodeUnknownResult(Schema.fromJsonString(ConfigFile), {
  onExcessProperty: "error",
})

/** Each role at the policy's initial estimate (decision P5). */
const defaultEstimates: Readonly<Record<Role, number>> = {
  [Roles.Implementer]: defaultPolicy.initialEstimate,
  [Roles.Reviewer]: defaultPolicy.initialEstimate,
  [Roles.Corrector]: defaultPolicy.initialEstimate,
}

/**
 * Decodes the configuration file's text. Fails with
 * {@link ConfigUndecodable} when the text is not JSON, a key is unknown
 * or missing, a path is not absolute, a pin is empty, or a value is out
 * of range.
 */
export const decodeForemanConfig = (text: string): Result.Result<ForemanConfig, ConfigUndecodable> =>
  Result.mapBoth(decodeFile(text), {
    onFailure: (error) => new ConfigUndecodable({ reason: String.trim(error.message) }),
    onSuccess: withEstimates,
  })

/** The file's fields with every role's estimate filled in. */
const withEstimates = ({ estimates, ...rest }: typeof ConfigFile.Type): ForemanConfig => ({
  ...rest,
  estimates: Option.getOrElse(Option.fromNullishOr(estimates), () => defaultEstimates),
})
