// Test helper: the real client starter, production's `startClientWith`
// over the real process listing and Format's start-time reading, for the
// tests that start real processes as clients, their time budget, and the
// bounded release loop their shell children wait in.
import { Effect } from "effect"
import { startTimeOf } from "../../src/format/ps.ts"
import { readProcesses } from "../../src/runtime/processes.ts"
import { startClientWith } from "../../src/runtime/spawn.ts"

/** The real client starter: each start spawns the client, then runs one `ps -A` for its start time. */
export const startRealClient = startClientWith(readProcesses, startTimeOf)

/**
 * A listing read without starting `ps`, empty, so the start time read
 * from it is none. Tests whose fact is neither the listing nor the start
 * time use it, so they start no `ps` their fact does not need (dogfood-6e,
 * owner ruling 3; correction 2, finding F3).
 */
export const noListing = () => Effect.succeed("")

/**
 * Production's `startClientWith` over {@link noListing}: each start
 * spawns the client and starts no `ps`.
 */
export const startClientWithoutListing = startClientWith(noListing, startTimeOf)

/**
 * The time budget, in milliseconds, of every test that starts a real
 * process through the client starter (dogfood-6e, owner ruling of
 * 2026-11-27): spawn.test.ts, client-output-bytes.test.ts and
 * inherited-pipe.test.ts. These tests claim nothing about speed; a start
 * through {@link startRealClient} runs a full `ps -A`, which took seconds
 * while other sessions kept the load average between 75 and 200, and
 * every start spawns a real process. Since correction 2 (finding F3) only
 * spawn.test's process-group test and inherited-pipe start `ps`; the rest
 * use {@link startClientWithoutListing}.
 *
 * What it bounds, counted from the code: the longest test of this kind,
 * inherited-pipe's "leaves an incomplete attempt that status, step-ended
 * and close --interrupted handle when tarlatan is interrupted", starts no
 * git and at least three `ps -A`: one in the client's start, one per
 * 100 ms poll until a listing shows the leader gone (at least one), and
 * one after the 400 ms watch. Its other starts are the leader `sh`, the
 * descendant `sh`, and the descendant's one `date` at its start, one
 * `date` and one `sleep` per 100 ms check until released, and one `mv`.
 * Each of its waits is bounded at 15 s; this budget is above any one of
 * them. Idle duration: 767 ms, measured by the coordinator on 2026-11-28
 * at a load average of about 3, before the F1 and F2 corrections; at most
 * 1,474 ms under load averages of 39 to 145.
 */
export const clientStartMillis = 30_000

/** Milliseconds in a second, for the shell's clock, which counts seconds. */
const millisPerSecond = 1_000

/**
 * A `sh` loop that runs until the file named by its first argument
 * exists, checking every 50 ms with a `sleep 0.05` in between, or until
 * `boundMillis` have passed by the clock it read at its start, and then
 * ends. A test passes its own time budget, so a loop whose release never
 * comes, because the test was interrupted before it could create the
 * file or its directory is already gone, still ends on its own and
 * outlives the test by at most that budget (dogfood-6e, finding F4).
 * Every `date` and `sleep` it starts ends before the next check.
 */
export const boundedReleaseLoop = (boundMillis: number) =>
  `end=$(( $(date +%s) + ${String(boundMillis / millisPerSecond)} )); ` +
  'while [ ! -e "$1" ] && [ "$(date +%s)" -lt "$end" ]; do sleep 0.05; done'
