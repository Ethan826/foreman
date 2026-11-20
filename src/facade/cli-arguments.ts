// The CLI's arguments (plan "Slice A1", facade): `--config <path>` first,
// then one of A1's commands. Parsing converts words into a command and
// decides nothing else; each command maps to one Program call in cli.ts.
//
//   worktree create
//   session open --tranche <id> --task <path>
//   implement [--waive]
//   status
//   step-ended <opId> --grant <grantId>
//   session close --abandoned|--interrupted [--note <text>]
import { Array as Arr, Option, Record, Result, Schema, String } from "effect"
import { GrantId, OpId, TrancheId } from "../domain/ids.ts"
import { CloseKind, CloseKinds } from "../domain/session.ts"

/** The words could not be read as an A1 command; `message` says why. */
export class UsageError extends Schema.TaggedError<UsageError>()("UsageError", { message: Schema.String }) {}

/** `worktree create`: create and record the supervisor worktree. */
export class CreateWorktree extends Schema.TaggedClass<CreateWorktree>()("CreateWorktree", {}) {}
/** `session open --tranche <id> --task <path>`. */
export class OpenSession extends Schema.TaggedClass<OpenSession>()("OpenSession", {
  tranche: TrancheId,
  taskFile: Schema.String,
}) {}
/** `implement [--waive]`. */
export class RunImplement extends Schema.TaggedClass<RunImplement>()("RunImplement", { waive: Schema.Boolean }) {}
/** `status`. */
export class ShowStatus extends Schema.TaggedClass<ShowStatus>()("ShowStatus", {}) {}
/** `step-ended <opId> --grant <grantId>`. */
export class EndStep extends Schema.TaggedClass<EndStep>()("EndStep", { opId: OpId, grantId: GrantId }) {}
/** `session close --abandoned|--interrupted [--note <text>]`. */
export class CloseSession extends Schema.TaggedClass<CloseSession>()("CloseSession", {
  how: CloseKind,
  note: Schema.String,
}) {}

/** Any A1 command. */
export type CliCommand = CreateWorktree | OpenSession | RunImplement | ShowStatus | EndStep | CloseSession

/** A parsed invocation: the configuration file and the command. */
export interface Invocation {
  readonly configPath: string
  readonly command: CliCommand
}

/** The flags one command takes: those with a value and those without. */
interface FlagSpec {
  readonly valued: ReadonlyArray<string>
  readonly switches: ReadonlyArray<string>
}

/** The flags found so far, and a valued flag still waiting for its value. */
interface Flags {
  readonly values: Readonly<Record<string, string>>
  readonly switches: ReadonlyArray<string>
  readonly pending: Option.Option<string>
}

/** The `--config` flag, which must come first. */
const configFlag = "--config"
/** The prefix every flag has. */
const flagPrefix = "--"
/** How many words `--config <path>` takes. */
const configWords = 2

/** The usage line printed with every usage error. */
export const usage =
  "usage: foreman --config <path> (worktree create | session open --tranche <id> --task <path> | " +
  "implement [--waive] | status | step-ended <opId> --grant <grantId> | " +
  "session close --abandoned|--interrupted [--note <text>])"

/** Reads `argv` (the words after the program) as an invocation, or says why not. */
export const parseArguments = (argv: ReadonlyArray<string>): Result.Result<Invocation, UsageError> =>
  Option.match(Option.filter(Arr.get(argv, 1), () => Option.contains(Arr.head(argv), configFlag)), {
    onNone: () => failed(`${configFlag} <path> must come first`),
    onSome: (configPath) =>
      Result.map(commandOf(Arr.drop(argv, configWords)), (command) => ({ configPath, command })),
  })

/** A command's leading words and the parser of what follows them. */
type CommandParser = readonly [
  ReadonlyArray<string>,
  (rest: ReadonlyArray<string>) => Result.Result<CliCommand, UsageError>,
]

/** The parsers of the A1 commands, by their leading words. */
const commands: ReadonlyArray<CommandParser> = [
  [["worktree", "create"], (rest) => withNoArguments(rest, new CreateWorktree())],
  [["session", "open"], (rest) => Result.flatMap(flagsOf(rest, { valued: ["--tranche", "--task"], switches: [] }), openOf)],
  [["session", "close"], (rest) => Result.flatMap(flagsOf(rest, { valued: ["--note"], switches: ["--abandoned", "--interrupted"] }), closeOf)],
  [["implement"], (rest) => Result.map(flagsOf(rest, { valued: [], switches: ["--waive"] }), implementOf)],
  [["status"], (rest) => withNoArguments(rest, new ShowStatus())],
  [["step-ended"], (rest) => stepEndedOf(rest)],
]

/** The command the words name, parsed with its own flags. */
const commandOf = (words: ReadonlyArray<string>): Result.Result<CliCommand, UsageError> =>
  Option.match(Arr.findFirst(commands, ([leading]: CommandParser) => startsWith(words, leading)), {
    onNone: () => failed(`unknown command: ${Arr.join(words, " ")}`),
    onSome: ([leading, parse]) => parse(Arr.drop(words, Arr.length(leading))),
  })

/** Whether `words` begins with `leading`. */
const startsWith = (words: ReadonlyArray<string>, leading: ReadonlyArray<string>) =>
  Arr.every(leading, (word, index) => Option.contains(Arr.get(words, index), word))

/** `command` when nothing follows it. */
const withNoArguments = (rest: ReadonlyArray<string>, command: CliCommand) =>
  Arr.isReadonlyArrayEmpty(rest) ? Result.succeed(command) : failed(`unexpected arguments: ${Arr.join(rest, " ")}`)

/** No flag found yet. */
const noFlags: Result.Result<Flags, UsageError> = Result.succeed({ values: {}, switches: [], pending: Option.none() })

/** Reads the flags in `args` by `spec`: each at most once, each valued flag with its value. */
const flagsOf = (args: ReadonlyArray<string>, spec: FlagSpec): Result.Result<Flags, UsageError> =>
  Result.flatMap(
    Arr.reduce(args, noFlags, (found, word) =>
      Result.flatMap(found, (flags) => withWord(flags, word, spec)),
    ),
    (flags) => (Option.isSome(flags.pending) ? failed(`${flags.pending.value} needs a value`) : Result.succeed(flags)),
  )

/** The flags after one more word. */
const withWord = (flags: Flags, word: string, spec: FlagSpec): Result.Result<Flags, UsageError> => {
  if (Option.isSome(flags.pending)) return Result.succeed(valueGiven(flags, flags.pending.value, word))
  if (Record.has(flags.values, word) || Arr.contains(flags.switches, word)) return failed(`${word} is given twice`)
  if (Arr.contains(spec.valued, word)) return Result.succeed({ ...flags, pending: Option.some(word) })
  if (Arr.contains(spec.switches, word)) return Result.succeed({ ...flags, switches: Arr.append(flags.switches, word) })
  return failed(`unknown argument: ${word}`)
}

/** Records `value` for the pending flag `flag`. */
const valueGiven = (flags: Flags, flag: string, value: string): Flags => ({
  ...flags,
  values: Record.set(flags.values, flag, value),
  pending: Option.none(),
})

/** `session open`: both flags are required. */
const openOf = (flags: Flags) =>
  Result.flatMap(required(flags, "--tranche"), (tranche) =>
    Result.flatMap(required(flags, "--task"), (taskFile) =>
      Result.map(decoded(TrancheId, tranche), (id) => new OpenSession({ tranche: id, taskFile })),
    ),
  )

/** `session close`: exactly one of `--abandoned` and `--interrupted`. */
const closeOf = (flags: Flags) =>
  Arr.match(flags.switches, {
    onEmpty: () => failed("session close needs --abandoned or --interrupted"),
    onNonEmpty: (kinds) =>
      Arr.length(kinds) > 1
        ? failed("session close takes one of --abandoned and --interrupted")
        : Result.succeed(
            new CloseSession({
              how: Arr.contains(kinds, "--abandoned") ? CloseKinds.Abandoned : CloseKinds.Interrupted,
              note: Option.getOrElse(Record.get(flags.values, "--note"), () => ""),
            }),
          ),
  })

/** `implement`: `--waive` or nothing. */
const implementOf = (flags: Flags) => new RunImplement({ waive: Arr.contains(flags.switches, "--waive") })

/** `step-ended <opId> --grant <grantId>`: the operation first, then the grant. */
const stepEndedOf = (rest: ReadonlyArray<string>): Result.Result<CliCommand, UsageError> =>
  Option.match(Option.filter(Arr.head(rest), (word) => !String.startsWith(flagPrefix)(word)), {
    onNone: () => failed("step-ended needs an operation id"),
    onSome: (opId) =>
      Result.flatMap(flagsOf(Arr.drop(rest, 1), { valued: ["--grant"], switches: [] }), (flags) =>
        Result.flatMap(required(flags, "--grant"), (grantId) => endStepOf(opId, grantId)),
      ),
  })

/** `step-ended`'s command once both identifiers decode. */
const endStepOf = (opId: string, grantId: string) =>
  Result.flatMap(decoded(OpId, opId), (op) =>
    Result.map(decoded(GrantId, grantId), (grant) => new EndStep({ opId: op, grantId: grant })),
  )

/** The value of a required flag. */
const required = (flags: Flags, flag: string) =>
  Option.match(Record.get(flags.values, flag), {
    onNone: () => failed<string>(`${flag} is required`),
    onSome: (value) => Result.succeed(value),
  })

/** Decodes an identifier, so one that is not a slug is refused. */
const decoded = <A>(schema: Schema.Decoder<A>, value: string): Result.Result<A, UsageError> =>
  Result.mapError(Schema.decodeUnknownResult(schema)(value), (error) => new UsageError({ message: error.message }))

/** A usage error with `message`. */
const failed = <A = never>(message: string): Result.Result<A, UsageError> => Result.fail(new UsageError({ message }))
