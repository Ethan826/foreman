// Ledger binding (design "Where the ledger lives and how instances
// coordinate"): at its first start a project appends `LedgerBound(path)`;
// a later start with another ledger path stops and reports, so a project
// cannot move to another ledger unnoticed.
import { Array as Arr, Option, Result, Schema } from "effect"
import { type ProjectEvent, LedgerBound } from "../domain/events.ts"

/** The configured ledger differs from the one the project is bound to. */
export class LedgerMoved extends Schema.TaggedError<LedgerMoved>()(
  "LedgerMoved",
  { bound: Schema.String, configured: Schema.String },
) {}

/** What startup does about the binding: append `LedgerBound`, or nothing. */
export type BindingStep = "bind" | "bound"

/**
 * Checks the project's first `LedgerBound` against the configured path:
 * none means "bind" (append one), the same path means "bound", another
 * path fails with {@link LedgerMoved}, and startup stops.
 */
export const checkLedgerBinding = (
  events: ReadonlyArray<ProjectEvent>,
  configured: string,
): Result.Result<BindingStep, LedgerMoved> =>
  Option.match(
    Arr.findFirst(events, (event) => Schema.is(LedgerBound)(event)),
    {
      onNone: () => Result.succeed("bind"),
      onSome: (event) =>
        Schema.is(LedgerBound)(event) && event.path !== configured
          ? Result.fail(new LedgerMoved({ bound: event.path, configured }))
          : Result.succeed("bound"),
    },
  )
