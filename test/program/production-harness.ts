// Test harness for the production composition (plan "Injected
// capabilities"; batch review B02 to B10): a disposable layout with an
// owner repository, a state directory, a ledger directory and a
// configuration file, and the CLI's `main` run over it exactly as the
// entry runs it. The clients are fake executables on the PATH the test
// passes as foreman's environment: `claude` and `codex` answer
// `--version` with the pins, record their argv and what they were given,
// run an optional shell action in their working directory, and print a
// recorded-shape successful run. No live client runs.
import { Console, Effect } from "effect"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { Clients } from "../../src/domain/clients.ts"
import type { LedgerSnapshot } from "../../src/domain/ledger.ts"
import { main } from "../../src/facade/cli.ts"
import { openLedger } from "../../src/runtime/ledger-sqlite.ts"
import { claudeSuccess } from "../fixtures/clients/claude-success.ts"
import { codexCompletedLines } from "../fixtures/clients/codex-events.ts"
import { cleanReviewMessage } from "../fixtures/clients/codex-review-clean.ts"
import { makeRepo } from "../runtime/git-repo.ts"

/**
 * The time budget of one end-to-end test, in milliseconds. Each runs
 * several CLI commands, each with git, SQLite and process starts, which
 * take more than vitest's default 5 seconds on a loaded machine.
 */
export const endToEndMillis = 60_000

/** The pins the fake clients print. */
export const pins = { [Clients.Claude]: "2.1.328 (Claude Code)", [Clients.Codex]: "codex-cli 0.170.0" }

/** Where everything of one test lives; every path is canonical. */
export interface Layout {
  readonly root: string
  readonly owner: string
  readonly state: string
  readonly ledgerDir: string
  readonly supervisor: string
  readonly bin: string
  /** Where the fake clients record what they were given. */
  readonly record: string
  readonly configPath: string
  readonly taskFile: string
}

/** What one CLI run printed and its exit status. */
export interface CliRun {
  readonly status: number
  readonly out: ReadonlyArray<string>
  readonly err: ReadonlyArray<string>
}

/** How long a test's ledger read waits for a writer, in milliseconds. */
const ledgerBusyMillis = 1_000

/** Owner read, write and execute; group and others read and execute. */
const executableMode = 0o755

/** A heredoc body that prints `lines`, one per line. */
const printed = (lines: ReadonlyArray<string>) => `cat <<'FOREMAN_EOF'\n${lines.join("\n")}\nFOREMAN_EOF\n`

/** The fake `claude`: records argv and the bytes of the `--settings` file, then succeeds. */
const fakeClaude = [
  "#!/bin/sh",
  `if [ "$1" = "--version" ]; then echo '${pins[Clients.Claude]}'; exit 0; fi`,
  'echo ran >> "$FAKE_RECORD/claude-launches"',
  'printf "%s\\n" "$@" > "$FAKE_RECORD/claude-argv"',
  'settings=""',
  'while [ $# -gt 0 ]; do if [ "$1" = "--settings" ]; then settings="$2"; fi; shift; done',
  'cat "$settings" > "$FAKE_RECORD/claude-settings-received"',
  'if [ -n "$FAKE_EDIT" ]; then sh -c "$FAKE_EDIT"; fi',
  printed(claudeSuccess.lines),
].join("\n")

/**
 * The fake `codex`: writes `$FAKE_MESSAGE`, or else a clean review, to
 * its `--output-last-message` file.
 */
const fakeCodex = [
  "#!/bin/sh",
  `if [ "$1" = "--version" ]; then echo '${pins[Clients.Codex]}'; exit 0; fi`,
  'echo ran >> "$FAKE_RECORD/codex-launches"',
  'out=""',
  'while [ $# -gt 0 ]; do if [ "$1" = "--output-last-message" ]; then out="$2"; fi; shift; done',
  'if [ -n "$FAKE_MESSAGE" ]; then printf "%s" "$FAKE_MESSAGE" > "$out"; fi',
  `if [ -z "$FAKE_MESSAGE" ]; then cat > "$out" <<'FOREMAN_EOF'\n${cleanReviewMessage}FOREMAN_EOF\nfi`,
  printed(codexCompletedLines),
].join("\n")

const script = (path: string, text: string) => {
  writeFileSync(path, text)
  chmodSync(path, executableMode)
}

/** A fresh layout under a canonical temporary directory, with the owner repository made. */
const makeLayout = Effect.gen(function* () {
  const root = realpathSync(mkdtempSync(`${tmpdir()}/foreman-production-`))
  const layout: Layout = {
    root,
    owner: `${root}/owner`,
    state: `${root}/state`,
    ledgerDir: `${root}/ledger`,
    supervisor: `${root}/supervisor`,
    bin: `${root}/bin`,
    record: `${root}/record`,
    configPath: `${root}/config.json`,
    taskFile: `${root}/task.md`,
  }
  for (const directory of [layout.state, layout.ledgerDir, layout.bin, layout.record]) mkdirSync(directory)
  script(`${layout.bin}/claude`, fakeClaude)
  script(`${layout.bin}/codex`, fakeCodex)
  writeFileSync(layout.taskFile, "Add a greeting.\n")
  yield* makeRepo(root, "owner")
  writeConfig(layout, configOf(layout))
  return layout
})

/** Runs `use` over a fresh layout and removes it afterwards. */
export const withLayout = <A, E>(use: (layout: Layout) => Effect.Effect<A, E>) =>
  Effect.acquireUseRelease(makeLayout, use, (layout) =>
    Effect.sync(() => {
      rmSync(layout.root, { recursive: true, force: true })
    }),
  )

/** The configuration of `layout`, with `overrides` replacing top-level keys. */
export const configOf = (layout: Layout, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  projectId: "alpha",
  stateDir: layout.state,
  ownerCheckout: layout.owner,
  supervisor: { path: layout.supervisor, name: "t" },
  attributeAllowance: { rootLines: [] },
  pins,
  ...overrides,
})

/** Writes `config` as the JSON file at `path` (the layout's own by default). */
export const writeConfig = (layout: Layout, config: Record<string, unknown>, path = layout.configPath) => {
  writeFileSync(path, JSON.stringify(config))
  return path
}

/** Options of one CLI run: another configuration file, and extra environment for the fakes. */
export interface CliOptions {
  readonly config?: string
  readonly env?: Record<string, string>
}

/** Does nothing: the console methods the CLI never calls. */
const ignored = () => undefined

/** A console that keeps `log` lines in `out` and `error` lines in `err`. */
const capturing = (out: Array<string>, err: Array<string>): Console.Console => ({
  assert: ignored, clear: ignored, count: ignored, countReset: ignored, debug: ignored, dir: ignored,
  dirxml: ignored, group: ignored, groupCollapsed: ignored, groupEnd: ignored, info: ignored,
  table: ignored, time: ignored, timeEnd: ignored, timeLog: ignored, trace: ignored, warn: ignored,
  log: (...args: ReadonlyArray<unknown>) => out.push(args.map(String).join(" ")),
  error: (...args: ReadonlyArray<unknown>) => err.push(args.map(String).join(" ")),
})

/** Runs `main` with `--config` and `words`, foreman's environment holding the fakes' PATH. */
export const cli = (layout: Layout, words: ReadonlyArray<string>, options: CliOptions = {}) =>
  Effect.gen(function* () {
    const out: Array<string> = []
    const err: Array<string> = []
    const console = capturing(out, err)
    const environment = { PATH: `${layout.bin}:/usr/bin:/bin`, FAKE_RECORD: layout.record, ...options.env }
    const argv = ["--config", options.config ?? layout.configPath, ...words]
    const status = yield* Effect.provideService(main(argv, environment), Console.Console, console)
    return { status, out, err } satisfies CliRun
  })

/** Runs `words` and fails the test unless the command exits 0. */
export const succeeded = (layout: Layout, words: ReadonlyArray<string>, options: CliOptions = {}) =>
  Effect.flatMap(cli(layout, words, options), (run) =>
    run.status === 0 ? Effect.succeed(run) : Effect.fail(`${words.join(" ")} exited ${String(run.status)}: ${run.err.join("\n")}`),
  )

/** Creates the supervisor worktree and opens a session on the task. */
export const openedSession = (layout: Layout, options: CliOptions = {}) =>
  Effect.gen(function* () {
    yield* succeeded(layout, ["worktree", "create"], options)
    yield* succeeded(layout, ["session", "open", "--tranche", "t-1", "--task", layout.taskFile], options)
  })

/** The error tag a failed run printed: the `_tag` of the JSON on stderr. */
export const failureTag = (run: CliRun): string => {
  const text = run.err.join("\n")
  const match = /"_tag": "([A-Za-z]+)"/.exec(text)
  return match?.[1] ?? text
}

/** What a fake client recorded under `name`, or undefined when it recorded nothing. */
export const recorded = (layout: Layout, name: string): string | undefined =>
  existsSync(`${layout.record}/${name}`) ? readFileSync(`${layout.record}/${name}`, "utf8") : undefined

/** The ledger file production opens for `layout`. */
export const ledgerPath = (layout: Layout) => `${layout.state}/ledger.sqlite`

/** The rows of a ledger snapshot, in seq order. */
const rowsOf = (snapshot: LedgerSnapshot) => snapshot.entries.map((entry) => entry.row)

/** Every row of the ledger at `path`, in seq order. */
export const ledgerRowsAt = (path: string) =>
  Effect.scoped(
    Effect.flatMap(openLedger(path, ledgerBusyMillis), (ledger) =>
      ledger.transact((tx) => Effect.map(tx.read, rowsOf)),
    ),
  )
