// The configuration file (plan "Slice A1", decisions P3 to P5): one JSON
// object naming the project, the state directory, the owner's checkout,
// the supervisor worktree's path and branch name, the root
// `.gitattributes` allowance (decision M09) and the client version pins.
// It names no Claude settings file, since tarlatan writes the editing
// profile itself (batch review B03), and no grant estimate, since every
// role reserves the policy's `initialEstimate` (decision P5, batch review
// B10). It may name check commands, which the editing profile then
// allows as exact Bash rules (dogfood-3b, check-command.ts); they are not
// part of the target binding. Decoding is strict: an unknown key, a
// relative path, a missing pin, a refused check command or a malformed
// value refuses the whole file, because a key the decoder ignored could
// be a setting the owner believes is in force.
import { Array as Arr, Option, Predicate, Result, Schema, String } from "effect"
import { ApprovedAttributeAllowance } from "../domain/attributes.ts"
import { Client } from "../domain/clients.ts"
import { ProjectId } from "../domain/ids.ts"
import { withoutByteOrderMark } from "./byte-order-mark.ts"
import { checkCommandsRefusal } from "./check-command.ts"

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
 * The supervisor branch's `<name>` in `tarlatan/<name>`: letters, digits,
 * dot, underscore and hyphen, 1 to 64 characters, the first a letter or
 * digit, so the branch name needs no quoting.
 */
const BranchName = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/))

/** The file name of the ledger in its directory. */
export const ledgerFileName = "ledger.sqlite"

/** The default ledger directory's name under `HOME`. */
const defaultLedgerName = ".tarlatan"

/** A client version pin: the client's `--version` output, trimmed (decision P4). */
const Pin = Schema.String.check(Schema.isNonEmpty())

/** Where the supervisor worktree lives and the name of its branch. */
const Supervisor = Schema.Struct({ path: AbsolutePath, name: BranchName })

/** The kinds of JSON value that are not strings, each with how a reason names it. */
const nonStringKinds: ReadonlyArray<readonly [Predicate.Predicate<unknown>, string]> = [
  [Predicate.isNumber, "a number"],
  [Predicate.isBoolean, "a boolean"],
  [Predicate.isNull, "null"],
  [Arr.isArray, "a list"],
]

/**
 * How a reason names a JSON value that is not a string: by its kind
 * alone, never by its contents, so the reason stays short and cannot fail
 * however large or deep the value is (second correction, finding F2). A
 * JSON value of no other kind is an object.
 */
const kindOf = (entry: unknown): string =>
  Option.getOrElse(
    Option.map(
      Arr.findFirst(nonStringKinds, ([isKind]) => isKind(entry)),
      ([, kind]) => kind,
    ),
    () => "an object",
  )

/** Why the entry at `index` is refused, when it is not a string. */
const nonStringReason = (entry: unknown, index: number): Option.Option<string> =>
  Predicate.isString(entry)
    ? Option.none()
    : Option.some(`the check command at index ${globalThis.String(index)} is ${kindOf(entry)}, not a string`)

/**
 * Whether every entry is a string, refusing the first that is not with a
 * message that gives its index and kind (owner finding F2). It aborts, so
 * no later check runs.
 */
const allStrings = Schema.makeFilter(
  (entries: ReadonlyArray<unknown>) =>
    Option.match(Arr.findFirst(entries, nonStringReason), {
      onNone: () => true,
      onSome: (reason) => reason,
    }),
  undefined,
  true,
)

/** Narrows a list that {@link allStrings} passed to a list of strings. */
const isStringList = (entries: ReadonlyArray<unknown>): entries is ReadonlyArray<string> =>
  Arr.every(entries, Predicate.isString)

/**
 * The check commands as written: a list of strings, refused whole when
 * any entry is not a string or is refused (`checkCommandsRefusal`), with
 * a message that names the entry (owner ruling of 2026-11-24).
 */
const CheckCommands = Schema.Array(Schema.Unknown)
  .check(allStrings)
  .pipe(Schema.refine(isStringList))
  .check(
    Schema.makeFilter((commands: ReadonlyArray<string>) =>
      Option.match(checkCommandsRefusal(commands), { onNone: () => true, onSome: (refusal) => refusal.reason }),
    ),
  )

/** The file as written. */
const ConfigFile = Schema.Struct({
  projectId: ProjectId,
  stateDir: AbsolutePath,
  ownerCheckout: AbsolutePath,
  supervisor: Supervisor,
  ledgerDir: Schema.optionalKey(AbsolutePath),
  attributeAllowance: ApprovedAttributeAllowance,
  pins: Schema.Record(Client, Pin),
  checkCommands: Schema.optionalKey(CheckCommands),
})

/** The decoded configuration. */
export interface TarlatanConfig {
  readonly projectId: ProjectId
  /** Holds the project's log and lock and every published state file. */
  readonly stateDir: string
  /** The owner's checkout, read only when the supervisor worktree is created. */
  readonly ownerCheckout: string
  /** The supervisor worktree's path and the `<name>` of `tarlatan/<name>`. */
  readonly supervisor: { readonly path: string; readonly name: string }
  /**
   * The directory of the owner's one ledger, shared by every project
   * (design "Where the ledger lives"); none means the default,
   * `<HOME>/.tarlatan` (see {@link ledgerDirOf}).
   */
  readonly ledgerDir: Option.Option<string>
  /** No root line, or Waxwing's one line (decision M09, batch review B06). */
  readonly attributeAllowance: ApprovedAttributeAllowance
  /** Each client's pinned `--version` output, trimmed (decision P4). */
  readonly pins: Readonly<Record<Client, string>>
  /**
   * The commands Claude's editing profile allows as exact `Bash(...)`
   * rules, in the file's order; empty when the key is absent. Not part
   * of the target binding (dogfood-3b).
   */
  readonly checkCommands: ReadonlyArray<string>
}

const decodeFile = Schema.decodeUnknownResult(Schema.fromJsonString(ConfigFile), {
  onExcessProperty: "error",
})

/**
 * Decodes the configuration file's text. Fails with
 * {@link ConfigUndecodable} when the text is not JSON, a key is unknown
 * or missing, a path is not absolute, a pin is empty, a check command is
 * refused (the reason names the entry), or a value is malformed. An
 * absent `checkCommands` is an empty list. One leading byte order mark is
 * dropped first (focused re-review finding 2).
 */
export const decodeTarlatanConfig = (text: string): Result.Result<TarlatanConfig, ConfigUndecodable> =>
  Result.mapBoth(decodeFile(withoutByteOrderMark(text)), {
    onFailure: (error) => new ConfigUndecodable({ reason: String.trim(error.message) }),
    onSuccess: ({ ledgerDir, checkCommands, ...rest }): TarlatanConfig => ({
      ...rest,
      ledgerDir: Option.fromNullishOr(ledgerDir),
      checkCommands: Option.getOrElse(Option.fromNullishOr(checkCommands), (): ReadonlyArray<string> => []),
    }),
  })

/**
 * The ledger's directory: the configured `ledgerDir`, or else
 * `<home>/.tarlatan`, the design's default, where `home` is tarlatan's own
 * `HOME`. Fails with {@link ConfigUndecodable} when neither is set or the
 * default would not be an absolute, normalized path.
 */
export const ledgerDirOf = (config: TarlatanConfig, home: Option.Option<string>): Result.Result<string, ConfigUndecodable> =>
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
