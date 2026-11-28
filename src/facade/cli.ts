// The CLI (plans "Slice A1" and "Slice A2", facade; decision P3). `main` parses the
// arguments (cli-arguments.ts), builds the production context in
// Program, calls the one Program function the command names, prints the
// result as JSON on stdout or the failure on stderr, and returns the exit
// status: 0 on success, 1 when the command failed, 2 on a usage error.
// It decides nothing.
//
// The entry statement that runs `main` with `process.argv` and
// `process.env` and exits with its status is in main.ts (owner ruling on
// A1, 2026-11-19): run `bun src/facade/main.ts --config <path> <command>`.
import { Cause, Console, Effect, Formatter, Match, Option, Result, Schema } from "effect"
import {
  FindingOverruled,
  HandoffRejected,
  RoundsGranted,
  RulingAdded,
  SessionClosed,
  SessionOpened,
  StepEndedByOwner,
  WorktreeCreated,
} from "../domain/events.ts"
import { AttemptRecorded } from "../program/attempt.ts"
import { correct } from "../program/correct.ts"
import { closeFinished, reject } from "../program/handoff.ts"
import { implement } from "../program/implement.ts"
import { review } from "../program/review.ts"
import { grantRounds } from "../program/rounds.ts"
import { addRuling, overrule } from "../program/rulings.ts"
import { production, type Production } from "../program/production.ts"
import {
  type ExitProduction,
  exitProduction,
  type StepEndedProduction,
  stepEndedProduction,
} from "../program/production-exits.ts"
import { closeSession, openSession, stepEnded } from "../program/session.ts"
import { productionStatus, StatusOutcome } from "../program/production-status.ts"
import { createRecordedWorktree } from "../program/worktree-command.ts"
import {
  type CliCommand,
  type CloseSession,
  type EndStep,
  type Invocation,
  parseArguments,
  type ShowStatus,
  usage,
} from "./cli-arguments.ts"

/** The exit status of a command that failed. */
const failedStatus = 1
/** The exit status of a usage error. */
const usageStatus = 2
/** The indent of printed JSON, in spaces. */
const jsonIndent = 2

/**
 * Runs the command `argv` names (the owner's words, `--config` first)
 * with tarlatan's own `environment`, and returns the exit status. Never
 * fails: a failure is printed and becomes status 1.
 */
export const main = (
  argv: ReadonlyArray<string>,
  environment: Readonly<Record<string, string | undefined>>,
): Effect.Effect<number> =>
  Result.match(parseArguments(argv), {
    onFailure: (error) => Effect.as(Console.error(`${error.message}\n${usage}`), usageStatus),
    onSuccess: (invocation) =>
      Effect.matchCauseEffect(Effect.scoped(executed(invocation, environment)), {
        onFailure: (cause) => Effect.as(Console.error(described(cause)), failedStatus),
        onSuccess: (text) => Effect.as(Console.log(text), 0),
      }),
  })

/**
 * The command run and printed. `status` has its own construction, which
 * opens nothing for writing, takes no lock and stays reachable under a
 * configuration naming another target (review items B11 and B04). The
 * owner's exits run over their own constructions, which run on the
 * recorded target whatever the configured layout says and never prepare
 * git's HOME (batch review B04, re-review R02, focused review finding 2):
 * `step-ended` over `stepEndedProduction`, which opens only the log and
 * the lock, and `session close --abandoned | --interrupted |
 * --unconverged` over
 * `exitProduction`, which also opens the ledger.
 * Every other command runs over `production`, which refuses a
 * configuration naming another target.
 */
const executed = (invocation: Invocation, environment: Readonly<Record<string, string | undefined>>) =>
  Match.value(invocation.command).pipe(
    Match.tag("ShowStatus", () => printed(StatusOutcome, productionStatus(invocation.configPath, environment))),
    Match.tag("EndStep", (ended) =>
      Effect.flatMap(stepEndedProduction(invocation.configPath, environment), runStepEnded(ended)),
    ),
    Match.tag("CloseSession", (close) =>
      Effect.flatMap(exitProduction(invocation.configPath, environment), runClose(close)),
    ),
    Match.orElse((command) => Effect.flatMap(production(invocation.configPath, environment), run(command))),
  )

/** `step-ended` over its log and lock, its result printed as JSON. */
const runStepEnded = (ended: EndStep) => (env: StepEndedProduction) =>
  printed(StepEndedByOwner, stepEnded(env.context, ended))

/** `session close --abandoned | --interrupted | --unconverged` over its context, its result printed as JSON. */
const runClose = (close: CloseSession) => (env: ExitProduction) =>
  printed(SessionClosed, closeSession(env.context, close))

/** The Program call for one command that runs over `production`, its result printed as JSON. */
const run = (command: Exclude<CliCommand, ShowStatus | EndStep | CloseSession>) => (env: Production) =>
  Match.value(command).pipe(
    Match.tag("CreateWorktree", () =>
      printed(WorktreeCreated, createRecordedWorktree(
        { log: env.context.capabilities.log, lock: env.context.capabilities.lock, create: env.worktree.createWorktree },
        { ownerCheckout: env.target.ownerCheckout, ...env.target.supervisor, start: Option.none() },
      )),
    ),
    Match.tag("OpenSession", (open) => printed(SessionOpened, openSession(env.context, open))),
    Match.tag("RunImplement", (options) => printed(AttemptRecorded, implement(env.context, options))),
    Match.tag("RunReview", (options) => printed(AttemptRecorded, review(env.context, options))),
    Match.tag("RunCorrect", (options) => printed(AttemptRecorded, correct(env.context, options))),
    Match.tag("RejectHandoff", (options) => printed(HandoffRejected, reject(env.context, options))),
    Match.tag("FinishSession", (finish) => printed(SessionClosed, closeFinished(env.context, finish))),
    Match.tag("RecordRuling", (ruling) => printed(RulingAdded, addRuling(env.context, ruling))),
    Match.tag("OverruleFinding", (finding) => printed(FindingOverruled, overrule(env.context, finding))),
    Match.tag("GrantRoundsCommand", (grant) => printed(RoundsGranted, grantRounds(env.context, grant))),
    Match.exhaustive,
  )

/** The result of `effect`, encoded by `schema` and laid out as indented JSON. */
const printed = <A, I, E, R>(schema: Schema.Codec<A, I>, effect: Effect.Effect<A, E, R>) =>
  Effect.map(Effect.flatMap(effect, Schema.encodeEffect(schema)), (encoded) =>
    Formatter.formatJson(encoded, { space: jsonIndent }),
  )

/** A failure as the owner reads it: the error's fields, or the whole cause for a defect. */
const described = (cause: Cause.Cause<unknown>) =>
  Option.match(Cause.findErrorOption(cause), {
    onSome: (error) => Formatter.formatJson(error, { space: jsonIndent }),
    onNone: () => Cause.pretty(cause),
  })
