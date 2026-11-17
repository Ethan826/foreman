// What the child fixtures share. They are entrypoints the lint does not
// let run an Effect, so they are synchronous: they read their arguments
// with Option and wait with Atomics.wait, which blocks only the child.
import { Array as Arr, Option } from "effect"

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

/** Blocks this child's thread until the process is killed. */
export const blockForever = () => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)), 0, 0)
}
