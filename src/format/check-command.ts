// The check commands the owner's configuration may name (dogfood-3b;
// owner rulings of 2026-11-23 and 2026-11-24): each is one command line
// as the agent would type it, which Claude's editing profile then allows
// as one exact `Bash(<command>)` rule. One rule refuses a malformed list
// in two places: the configuration decoder, so every command fails at
// once, and the profile, as a second guard.
//
// An exact rule limits the command line, not what runs: a command that
// runs repository code lets the agent run any code inside the Bash
// sandbox, and the sandbox is the guard. Refusing `git` and `curl` here
// catches an owner's typo; it is not a boundary.
import { Array as Arr, Formatter, Option, String } from "effect"

/** The longest check command, in characters. */
const maxLength = 200

/**
 * Only letters, digits, space and `._/:=@+-`. This keeps out quotes,
 * `;`, `|`, `&`, `$` and `*`. It does not decide how the shell reads the
 * line: the line may still begin with an assignment such as `PORT=8080`.
 */
const plainCharacters = /^[A-Za-z0-9 ._/:=@+-]*$/

/**
 * Whether `command` is the text `program`, or begins with `program` and a
 * space. This compares text only: it does not find the program the shell
 * would run, so `PORT=1 git log` passes it.
 */
const runs = (program: string) => (command: string) =>
  command === program || String.startsWith(`${program} `)(command)

/** Each way a single command is refused, with what the reason says of it, in the order checked. */
const flaws: ReadonlyArray<readonly [(command: string) => boolean, string]> = [
  [String.isEmpty, "is empty"],
  [(command) => String.length(command) > maxLength, `is longer than ${globalThis.String(maxLength)} characters`],
  [(command) => !plainCharacters.test(command), "holds a character other than letters, digits, space and ._/:=@+-"],
  [(command) => String.startsWith(" ")(command) || String.endsWith(" ")(command), "starts or ends with a space"],
  [String.includes("  "), "holds a doubled space"],
  [runs("git"), "runs git"],
  [runs("curl"), "runs curl"],
]

/** A refused entry of a check command list, and the reason, which names it. */
export interface CheckCommandRefusal {
  readonly command: string
  readonly reason: string
}

/** The refusal of `command` for `why`, quoting it as a JSON string so an empty entry stays visible. */
const refusalOf = (command: string, why: string): CheckCommandRefusal => ({
  command,
  reason: `the check command ${Formatter.formatJson(command)} ${why}`,
})

/** Why one command is refused, if it is. */
const flawOf = (command: string): Option.Option<CheckCommandRefusal> =>
  Option.map(
    Arr.findFirst(flaws, ([isFlawed]) => isFlawed(command)),
    ([, why]) => refusalOf(command, why),
  )

/** The first entry that repeats an earlier one, if any. */
const firstDuplicate = (commands: ReadonlyArray<string>): Option.Option<CheckCommandRefusal> =>
  Option.map(
    Arr.findFirst(commands, (command, index) => Arr.contains(Arr.take(commands, index), command)),
    (command) => refusalOf(command, "is listed twice"),
  )

/**
 * The first refusal of a check command list, or none when it passes. An
 * entry is refused when it is empty, longer than 200 characters, holds a
 * character other than letters, digits, space and `._/:=@+-`, starts or
 * ends with a space, holds a doubled space, or is `git` or `curl`, bare
 * or with arguments; these are checked entry by entry first, and then an
 * entry listed twice is refused. The reason names the entry.
 */
export const checkCommandsRefusal = (commands: ReadonlyArray<string>): Option.Option<CheckCommandRefusal> =>
  Option.orElse(Arr.findFirst(commands, flawOf), () => firstDuplicate(commands))
