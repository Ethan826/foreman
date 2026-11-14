# Dependency intake

2026-11-14. Four packages, all exact-pinned in `package.json`, resolved by
`bun install` into the committed `bun.lock`. `bun pm ls --all` lists 71
installed entries (many are platform-specific optional binaries of the
bundler; only the host's are loaded). The versions were chosen by the
author; this record reviews the choice.

## effect 4.1.4

- Why: Effect v4 is the project's chosen language runtime (AGENTS.md).
  Schema decodes the foreign formats and validates identifiers; Order and
  Array carry the pure pacing function; Layer and Context.Service will
  carry Runtime later.
- Alternatives considered: zod or valibot for decoding (a second
  vocabulary beside Effect, no gain); plain TypeScript with hand-written
  guards (unsafe casts, contrary to the baseline).
- Footprint: no runtime dependencies. Runtime dependency of the project.
- Fit: modules `Schema`, `Array`, `Order`, `Result` only so far; Domain,
  Features and Format import `effect` and nothing else.
- Release cycle and maintenance: Effect-TS organization; minor releases add
  and rename APIs, so upgrades are reviews, not bumps.
- Security and supply chain: no install scripts, no downloaded binaries.
- License: MIT.
- Pinning: exact `4.1.4`.

## @effect/vitest 4.1.4

- Why: Effect-aware test helpers (`it.effect`, layers, test clock) for the
  Runtime and Program tests to come. Pure tests use only its re-exports of
  vitest.
- Alternatives considered: plain vitest (works for the pure tests, loses
  Effect test services later).
- Footprint: dev-only; no dependencies of its own; peer of vitest 5.
- Fit: test files only.
- Release cycle and maintenance: versioned in lockstep with `effect`.
- Security and supply chain: no install scripts.
- License: MIT.
- Pinning: exact `4.1.4`, equal to `effect`.

## vitest 5.1.0

- Why: test runner required by `@effect/vitest`.
- Alternatives considered: `bun test` (not supported by `@effect/vitest`);
  node:test (no matching Effect helpers).
- Footprint: dev-only. Direct dependencies include chai, tinybench,
  tinyexec, tinyglobby, picomatch, magic-string and std-env; it also brings
  vite 8.3.8 with rolldown and lightningcss, which ship platform-specific
  native binaries (optional packages, installed from the npm registry).
- Fit: the runner and its `expect`; no browser mode, mocking or snapshot
  features used.
- Release cycle and maintenance: frequent majors; pinned, upgraded on
  purpose.
- Security and supply chain: native binaries for the bundler. No install
  scripts were observed in the four direct packages' manifests.
- License: MIT.
- Pinning: exact `5.1.0`.

## typescript 5.9.3

- Why: type checking (`bun run check` is `tsc --noEmit`); the strictest
  settings, including `exactOptionalPropertyTypes`, are part of the design.
- Alternatives considered: none; the effect-v4 skill is checked against
  this version.
- Footprint: dev-only; no dependencies.
- Fit: compiler only; nothing is emitted.
- Release cycle and maintenance: Microsoft; minor releases every few
  months.
- Security and supply chain: no install scripts.
- License: Apache-2.0 (compatible with the project's use).
- Pinning: exact `5.9.3`.

## Considered and declined

- A lint stack (ESLint, oxlint): the baseline's gates (no casts, no
  throws, no loops in core code, layer import edges) are not yet
  enforced by machine. Needs its own intake and a gate-integrity pass
  before the first Runtime code.
