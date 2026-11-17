import { Array as Arr, Option } from "effect"

// Four callbacks deep: one past the readable-functional-code nesting limit.
export const deepest = (rows: ReadonlyArray<ReadonlyArray<number>>): ReadonlyArray<Option.Option<number>> =>
  Arr.map(rows, (row) =>
    Option.flatMap(Arr.head(row), (first) =>
      Option.flatMap(Arr.last(row), (last) =>
        Option.map(Option.some(first + last), (sum) => sum * 2),
      ),
    ),
  )
