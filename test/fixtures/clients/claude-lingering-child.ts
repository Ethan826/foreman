// A Claude run whose leader exits cleanly while a child it started keeps
// writing in the working directory (plan "Quiescence, inspection and
// snapshots"). The child is a real `sh` that appends a line to
// `lingering.txt` five times, a tenth of a second apart, and then ends
// on its own; foreman never signals it. A test waits for `ended` before
// it removes the directory.
import { Effect } from "effect"
import { type ChildProcess, spawn } from "node:child_process"
import { claudeSuccess } from "./claude-success.ts"
import type { ClientScript } from "./fake-client.ts"

/** The file the child appends to, in the working directory. */
export const lingeringFile = "lingering.txt"

/** The child's script: five appends, then it exits. */
const childScript = `for line in 1 2 3 4 5; do echo "$line" >> ${lingeringFile}; sleep 0.1; done`

/** A lingering-child client, and an effect that ends once its child has ended. */
export interface LingeringChild {
  readonly script: ClientScript
  readonly ended: Effect.Effect<unknown>
}

/** A successful Claude run that leaves a child writing in its working directory. */
export const claudeLingeringChild = (): LingeringChild => {
  const children: Array<Effect.Effect<undefined>> = []
  const script: ClientScript = {
    ...claudeSuccess,
    alongside: (launch) => {
      children.push(closeOf(spawn("sh", ["-c", childScript], options(launch.cwd))))
    },
  }
  return { script, ended: Effect.suspend(() => Effect.all(children, { discard: true })) }
}

/** The child's options: its own process group, a minimal PATH, no input. */
const options = (cwd: string) =>
  ({ cwd, env: { PATH: "/bin:/usr/bin" }, detached: true, stdio: ["ignore", "pipe", "pipe"] }) as const

/** An effect that ends once `child` has closed, at once if it already has. */
const closeOf = (child: ChildProcess): Effect.Effect<undefined> => {
  let closed = false
  const waiting: Array<(done: Effect.Effect<undefined>) => void> = []
  child.on("close", () => {
    closed = true
    for (const resume of waiting) resume(Effect.undefined)
  })
  return Effect.callback<undefined>((resume) => {
    if (closed) resume(Effect.undefined)
    else waiting.push(resume)
  })
}
