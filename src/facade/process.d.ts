// The project installs no Node or Bun type package; this declares the
// three members of Bun's Node-compatible `process` global (Bun 1.3.6)
// that the CLI's entry, src/facade/main.ts, uses (owner ruling on A1,
// 2026-11-19): `argv`, `env` and `exit`, and nothing else. The process
// gate (test/runtime/git-process-gate.test.ts) still forbids every
// reference to `process` outside main.ts, so this declaration widens what
// compiles, not what passes. The gate does not count the name declared
// below as a reference (owner ruling, 2026-11-20), but it counts every
// use of it, in this file as anywhere else.
// The test-only declaration in test/runtime/bun-spawn.d.ts adds
// `execPath` to {@link Process} by interface merging and declares no
// second `process`.

/** The parts of Bun's `process` global that foreman declares. */
interface Process {
  /**
   * The runtime's executable, the script's path, then the script's
   * arguments: for `bun src/facade/main.ts --config <path> status`, the
   * owner's words start at index 2.
   */
  readonly argv: ReadonlyArray<string>
  /**
   * The process environment, by variable name; a child started without
   * an environment of its own inherits it.
   */
  readonly env: Record<string, string>
  /** Ends the process at once with exit status `code`; never returns. */
  exit(code: number): never
}

/** Bun's Node-compatible `process` global, limited to {@link Process}. */
declare const process: Process
