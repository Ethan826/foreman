// What the child fixtures share. They are entrypoints the lint does not
// let run an Effect, so they are synchronous: they read their arguments
// with Option and wait with Atomics.wait, which blocks only the child. A
// child that must not release what it holds until the parent has seen it
// held waits for a go file the parent writes (dogfood-6e, finding F3).
import { Array as Arr, Option } from "effect"
import { existsSync } from "node:fs"

/** The arguments after the script path. */
const args = Arr.drop(process.argv, 2)

/**
 * Runs `use` with the first three arguments (target path, ready-file path,
 * and a count of milliseconds, 0 when absent). With fewer than two, it
 * does nothing, writes no ready file, and the parent's bounded wait fails.
 */
export const withArgs = (use: (target: string, ready: string, millis: number) => void) =>
  Option.match(Option.all([Arr.get(args, 0), Arr.get(args, 1)]), {
    onNone: () => undefined,
    onSome: ([target, ready]) => {
      use(target, ready, Option.getOrElse(Option.map(Arr.get(args, 2), Number), () => 0))
    },
  })

/** Blocks this child's thread for `millis` milliseconds. */
export const blockFor = (millis: number) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)), 0, 0, millis)
}

/** The interval between a child's checks for its go file, in milliseconds. */
const goCheckMillis = 10

/** The file whose existence tells a child that the parent saw what it waits for: `<ready>.go`. */
export const goFileOf = (ready: string) => `${ready}.go`

/**
 * Blocks, checking every few milliseconds and sleeping in between, until
 * the go file of `ready` exists or the clock passes `deadline`, in epoch
 * milliseconds; whether the go file came.
 */
const awaitGoUntil = (ready: string, deadline: number): boolean => {
  if (existsSync(goFileOf(ready))) return true
  if (Date.now() >= deadline) return false
  blockFor(goCheckMillis)
  return awaitGoUntil(ready, deadline)
}

/**
 * Blocks until the parent writes the go file of `ready`, or for at most
 * `boundMillis`, the parent's own bound on its waits; whether it came.
 * Each check is one `existsSync`, so the recursion is as deep as the
 * checks: at most `boundMillis / goCheckMillis`, a thousand for ten
 * seconds.
 */
export const awaitGo = (ready: string, boundMillis: number): boolean => awaitGoUntil(ready, Date.now() + boundMillis)

/** Blocks this child's thread until the process is killed. */
export const blockForever = () => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)), 0, 0)
}
