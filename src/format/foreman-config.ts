// The configuration file (plan "Slice A1", decisions P3 to P5): one JSON
// object naming the project, the state directory, the owner's checkout,
// the supervisor worktree's path and branch name, the root
// `.gitattributes` allowance (decision M09) and the client version pins.
// It names no Claude settings file, since foreman writes the editing
// profile itself (batch review B03), and no grant estimate, since every
// role reserves the policy's `initialEstimate` (decision P5, batch review
// B10). Decoding is strict: an unknown key, a relative path, a missing pin
// or a malformed value refuses the whole file, because a key the decoder
// ignored could be a setting the owner believes is in force.
import { Option, Result, Schema, String } from "effect"
import { ApprovedAttributeAllowance } from "../domain/attributes.ts"
import { Client } from "../domain/clients.ts"
import { ProjectId } from "../domain/ids.ts"

/** The configuration file could not be decoded; `reason` says where. */
export class ConfigUndecodable extends Schema.TaggedError<ConfigUndecodable>()(
  "ConfigUndecodable",
  { reason: Schema.String },
) {}

/**
 * An absolute, normalized path: `/` and then one or more components
 * separated by single slashes, none of them `.` or `..`, with no trailing
 * slash. The layout check (batch review B05) compares these after
 * resolving links, so a component it could not interpret is refused here.
 */
const AbsolutePath = Schema.String.check(Schema.isPattern(/^(?:\/(?!\.\.?(?:\/|$))[^/\0]+)+$/))

/**
 * The supervisor branch's `<name>` in `foreman/<name>`: letters, digits,
 * dot, underscore and hyphen, 1 to 64 characters, the first a letter or
 * digit, so the branch name needs no quoting.
 */
const BranchName = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/))

/** The file name of the ledger in its directory. */
export const ledgerFileName = "ledger.sqlite"

/** The default ledger directory's name under `HOME`. */
const defaultLedgerName = ".foreman"

/** A client version pin: the client's `--version` output, trimmed (decision P4). */
const Pin = Schema.String.check(Schema.isNonEmpty())

/** Where the supervisor worktree lives and the name of its branch. */
const Supervisor = Schema.Struct({ path: AbsolutePath, name: BranchName })

/** The file as written. */
const ConfigFile = Schema.Struct({
  projectId: ProjectId,
  stateDir: AbsolutePath,
  ownerCheckout: AbsolutePath,
  supervisor: Supervisor,
  ledgerDir: Schema.optionalKey(AbsolutePath),
  attributeAllowance: ApprovedAttributeAllowance,
  pins: Schema.Record(Client, Pin),
})

/** The decoded configuration. */
export interface ForemanConfig {
  readonly projectId: ProjectId
  /** Holds the project's log and lock and every published state file. */
  readonly stateDir: string
  /** The owner's checkout, read only when the supervisor worktree is created. */
  readonly ownerCheckout: string
  /** The supervisor worktree's path and the `<name>` of `foreman/<name>`. */
  readonly supervisor: { readonly path: string; readonly name: string }
  /**
   * The directory of the owner's one ledger, shared by every project
   * (design "Where the ledger lives"); none means the default,
   * `<HOME>/.foreman` (see {@link ledgerDirOf}).
   */
  readonly ledgerDir: Option.Option<string>
  /** No root line, or Waxwing's one line (decision M09, batch review B06). */
  readonly attributeAllowance: ApprovedAttributeAllowance
  /** Each client's pinned `--version` output, trimmed (decision P4). */
  readonly pins: Readonly<Record<Client, string>>
}

const decodeFile = Schema.decodeUnknownResult(Schema.fromJsonString(ConfigFile), {
  onExcessProperty: "error",
})

/**
 * Decodes the configuration file's text. Fails with
 * {@link ConfigUndecodable} when the text is not JSON, a key is unknown
 * or missing, a path is not absolute, a pin is empty, or a value is
 * malformed.
 */
export const decodeForemanConfig = (text: string): Result.Result<ForemanConfig, ConfigUndecodable> =>
  Result.mapBoth(decodeFile(text), {
    onFailure: (error) => new ConfigUndecodable({ reason: String.trim(error.message) }),
    onSuccess: ({ ledgerDir, ...rest }): ForemanConfig => ({ ...rest, ledgerDir: Option.fromNullishOr(ledgerDir) }),
  })

/**
 * The ledger's directory: the configured `ledgerDir`, or else
 * `<home>/.foreman`, the design's default, where `home` is foreman's own
 * `HOME`. Fails with {@link ConfigUndecodable} when neither is set or the
 * default would not be an absolute, normalized path.
 */
export const ledgerDirOf = (config: ForemanConfig, home: Option.Option<string>): Result.Result<string, ConfigUndecodable> =>
  Option.match(config.ledgerDir, {
    onSome: Result.succeed,
    onNone: () =>
      Option.match(home, {
        onNone: () => Result.fail(new ConfigUndecodable({ reason: "ledgerDir is not set and HOME is unset" })),
        onSome: (directory) => defaultLedgerDir(`${directory}/${defaultLedgerName}`),
      }),
  })

/** A default ledger directory, refused unless it is an absolute, normalized path. */
const defaultLedgerDir = (path: string) =>
  Result.mapError(
    Schema.decodeUnknownResult(AbsolutePath)(path),
    () => new ConfigUndecodable({ reason: `the default ledger directory ${path} is not an absolute, normalized path` }),
  )
