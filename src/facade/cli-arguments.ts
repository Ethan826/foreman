// The CLI's arguments (plans "Slice A1" and "Slice A2", facade):
// `--config <path>` first, then one command. Parsing converts words into
// a command (cli-commands.ts) and decides nothing else; each command
// maps to one Program call in cli.ts.
//
//   worktree create
//   session open --tranche <id> --task <path>
//   implement [--waive]
//   review [--waive] --attest
//   correct --findings <file> [--waive] --attest
//   reject [--note <text>]
//   status
//   step-ended <opId> --grant <grantId>
//   session close --abandoned|--interrupted [--note <text>]
//   session close --finished --attest [--note <text>]
//   ruling add --text <text> [--supersedes <rulingId>]
//   overrule <findingId> --note <reason>
//
// The texts of `ruling add` and `overrule` are required and kept as
// given, line breaks included; one that is empty or only whitespace is a
// usage error (v0.2.0, dogfood-6b).
import { Array as Arr, Option, Record, Result, Schema, String } from "effect"
import { GrantId, OpId, RulingId, TrancheId } from "../domain/ids.ts"
import { CloseKinds } from "../domain/session.ts"
import {
  type CliCommand,
  CloseSession,
  CreateWorktree,
  EndStep,
  FinishSession,
  OpenSession,
  OverruleFinding,
  RecordRuling,
  RejectHandoff,
  RunCorrect,
  RunImplement,
  RunReview,
  ShowStatus,
} from "./cli-commands.ts"

export {
  type CliCommand,
  CloseSession,
  CreateWorktree,
  EndStep,
  FinishSession,
  OpenSession,
  OverruleFinding,
  RecordRuling,
  RejectHandoff,
  RunCorrect,
  RunImplement,
  RunReview,
  ShowStatus,
} from "./cli-commands.ts"

/** The words could not be read as a command; `message` says why. */
export class UsageError extends Schema.TaggedError<UsageError>()("UsageError", { message: Schema.String }) {}

/** A parsed invocation: the configuration file and the command. */
export interface Invocation {
  readonly configPath: string
  readonly command: CliCommand
}

/** The switches `session close` reads: one kind, and `--attest` for `--finished`. */
const closeSwitches = ["--abandoned", "--interrupted", "--finished", "--attest"]

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

/**
 * The usage text printed with every usage error: the commands, then the
 * owner's rule for a launch that does not return after its client
 * exited (owner ruling on L01, 2026-11-20).
 */
export const usage =
  "usage: tarlatan --config <path> (worktree create | session open --tranche <id> --task <path> | " +
  "implement [--waive] | review [--waive] --attest | correct --findings <file> [--waive] --attest | " +
  "reject [--note <text>] | status | step-ended <opId> --grant <grantId> | " +
  "session close --abandoned|--interrupted [--note <text>] | session close --finished --attest [--note <text>] | " +
  "ruling add --text <text> [--supersedes <rulingId>] | overrule <findingId> --note <reason>)\n" +
  "A launch waits until its client's output closes, and tarlatan never signals a client. If a launch does " +
  "not return after its client exited, a process the client started still holds its output: interrupt " +
  "tarlatan, then run status, step-ended <opId> --grant <grantId>, then session close --interrupted."

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

/** The parsers of the commands, by their leading words. */
const commands: ReadonlyArray<CommandParser> = [
  [["worktree", "create"], (rest) => withNoArguments(rest, new CreateWorktree())],
  [["session", "open"], (rest) => Result.flatMap(flagsOf(rest, { valued: ["--tranche", "--task"], switches: [] }), openOf)],
  [["session", "close"], (rest) => Result.flatMap(flagsOf(rest, { valued: ["--note"], switches: closeSwitches }), closeOf)],
  [["implement"], (rest) => Result.map(flagsOf(rest, { valued: [], switches: ["--waive"] }), implementOf)],
  [["review"], (rest) => Result.map(flagsOf(rest, { valued: [], switches: ["--waive", "--attest"] }), reviewOf)],
  [["correct"], (rest) => Result.flatMap(flagsOf(rest, { valued: ["--findings"], switches: ["--waive", "--attest"] }), correctOf)],
  [["reject"], (rest) => Result.map(flagsOf(rest, { valued: ["--note"], switches: [] }), rejectOf)],
  [["status"], (rest) => withNoArguments(rest, new ShowStatus())],
  [["step-ended"], (rest) => stepEndedOf(rest)],
  [["ruling", "add"], (rest) => Result.flatMap(flagsOf(rest, { valued: ["--text", "--supersedes"], switches: [] }), rulingOf)],
  [["overrule"], (rest) => overruleOf(rest)],
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

/** `session close`: exactly one kind; `--attest` only with `--finished`. */
const closeOf = (flags: Flags) =>
  Arr.match(Arr.filter(flags.switches, (word) => word !== "--attest"), {
    onEmpty: () => failed("session close needs --abandoned, --interrupted or --finished"),
    onNonEmpty: (kinds) =>
      Arr.length(kinds) > 1
        ? failed("session close takes one of --abandoned, --interrupted and --finished")
        : closeKindOf(Arr.headNonEmpty(kinds), noteOf(flags), Arr.contains(flags.switches, "--attest")),
  })

/** The close command for one kind flag, with the note and whether `--attest` was given. */
const closeKindOf = (kind: string, note: string, attest: boolean): Result.Result<CliCommand, UsageError> => {
  if (kind === "--finished") return Result.succeed(new FinishSession({ note, attest }))
  if (attest) return failed("--attest goes only with session close --finished")
  return Result.succeed(new CloseSession({ how: kind === "--abandoned" ? CloseKinds.Abandoned : CloseKinds.Interrupted, note }))
}

/** The `--note` given, or an empty note. */
const noteOf = (flags: Flags) => Option.getOrElse(Record.get(flags.values, "--note"), () => "")

/** `review`: `--waive` and `--attest`, each optional. */
const reviewOf = (flags: Flags) =>
  new RunReview({ waive: Arr.contains(flags.switches, "--waive"), attest: Arr.contains(flags.switches, "--attest") })

/** `correct`: `--findings` is required; `--waive` and `--attest` are optional. */
const correctOf = (flags: Flags) =>
  Result.map(
    required(flags, "--findings"),
    (findingsFile) =>
      new RunCorrect({
        findingsFile,
        waive: Arr.contains(flags.switches, "--waive"),
        attest: Arr.contains(flags.switches, "--attest"),
      }),
  )

/** `reject`: an optional note. */
const rejectOf = (flags: Flags) => new RejectHandoff({ note: noteOf(flags) })

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

/** `ruling add`: `--text` is required and non-blank; `--supersedes`, if given, is a ruling id. */
const rulingOf = (flags: Flags) =>
  Result.flatMap(requiredText(flags, "--text"), (text) =>
    Result.map(supersedesOf(flags), (supersedes) => new RecordRuling({ text, supersedes })),
  )

/** The ruling `--supersedes` names, decoded, or none when it is not given. */
const supersedesOf = (flags: Flags): Result.Result<Option.Option<RulingId>, UsageError> =>
  Option.match(Record.get(flags.values, "--supersedes"), {
    onNone: () => Result.succeed(Option.none()),
    onSome: (value) => Result.map(decoded(RulingId, value), Option.some),
  })

/**
 * `overrule <findingId> --note <reason>`: the first word is always the
 * finding id, any non-empty word, even one that starts with `--` (as
 * `Finding.id` allows); then the required, non-blank note.
 */
const overruleOf = (rest: ReadonlyArray<string>): Result.Result<CliCommand, UsageError> =>
  Option.match(Option.filter(Arr.head(rest), String.isNonEmpty), {
    onNone: () => failed("overrule needs a finding id"),
    onSome: (findingId) =>
      Result.flatMap(flagsOf(Arr.drop(rest, 1), { valued: ["--note"], switches: [] }), (flags) =>
        Result.map(requiredText(flags, "--note"), (note) => new OverruleFinding({ findingId, note })),
      ),
  })

/**
 * The value of a required text flag, kept as given; one that is empty or
 * only whitespace is a usage error.
 */
const requiredText = (flags: Flags, flag: string) =>
  Result.flatMap(required(flags, flag), (value) =>
    String.isEmpty(String.trim(value)) ? failed<string>(`${flag} must not be empty`) : Result.succeed(value),
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
