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

## Lint stack (2026-11-14, branch `lint`)

Four more packages, all dev-only and exact-pinned, so that the baseline's
gates (no casts, throws, loops, mutation, async or throwing Schema calls in
core code; layer import edges) are enforced by machine. `bun pm ls --all`
went from 71 to 202 entries (+131). Measured apart in a scratch project,
eslint, @eslint/js and typescript-eslint account for nearly all of it
(about 105 entries beyond typescript); eslint-plugin-functional adds
about 5. No package here declares an install script; no native binaries.
Versions equal the ones the owner's lsatchapelhill project resolves
(`^9.39.2`, `^8.54.0`, `^9.0.4`), pinned exactly. License of all four: MIT.

- **eslint 9.39.2** and **@eslint/js 9.39.2**: the linter and its
  recommended preset (same version, as eslint requires). Alternative:
  oxlint or biome (no type-aware typescript-eslint rules, none of the
  owner's existing rules to reuse). Release cycle: OpenJS Foundation,
  frequent minors; upgrades are reviews. ESLint 10 is out of scope until
  typescript-eslint supports it.
- **typescript-eslint 8.54.0**: parser and the strictTypeChecked and
  stylisticTypeChecked presets (type-aware: no-unsafe-*, no-floating-promises,
  consistent-type-assertions, no-non-null-assertion). Peer range accepts
  typescript 5.9.3. Pulls @typescript-eslint/{parser,eslint-plugin,utils,
  typescript-estree} and ts-api-utils.
- **eslint-plugin-functional 9.0.4**: only for `no-loop-statements`,
  `no-throw-statements`, `no-let` and `immutable-data`. The first two are also
  covered by core syntax selectors, so the plugin is redundant for them;
  `immutable-data` (assignment to properties, mutating array methods such as
  sort and splice) and `no-let` cannot be done with core rules. It brings
  deepmerge-ts, is-immutable-type, ts-declaration-location,
  escape-string-regexp. Declined alternative: write the two rules ourselves
  (invented machinery; the plugin is published and used in lsatchapelhill).

Taken from lsatchapelhill (`eslint-fp-rules.js`, `apps/api/eslint.config.js`):
the loop, `array[0]`, `.push`, `.length`, try, throw, instanceof, Promise,
async and JSON selectors; the three plugin rules; the strict and stylistic
preset pairing; generic array types; the layer-import rule. Core
`no-restricted-imports` replaces `eslint-plugin-import`'s
`no-restricted-paths` (that plugin was not installed: one rule does not
justify a package, and the core rule also bans `node:*` in core layers). Added from the effect-v4
and readable-functional-code skills: `Schema.decode*` Sync, Promise, v3 name
and `asserts` bans (as member access and as named imports from
`effect/Schema`), `Effect.run*` and `Effect.promise`, `getOrThrow`, `_tag`
reads, `while` and `do`, `await`, `Promise` types, `as` casts and `!`,
arrow-function style (`func-style`, `prefer-arrow-callback`), `no-let`.
Left out as app-specific or style: React, jsx-a11y, tenant, Stripe and path
rules; jsdoc, tsdoc, simple-import-sort, eslint-config-prettier, `quotes`,
`semi`, `no-warning-comments`, `prefer-destructuring`, `curly`,
`import/*` checks; the DOM entries of `ignoreAccessorPattern`.

Blind spots (gate-integrity): the syntax bans match the names `Schema`, `S`,
`Effect`, `Option`, `Result`, `JSON` and `Promise`; a rename on import
(`import { Schema as Sch }`) or destructuring (`const { decode } = Schema`)
escapes the member-access selectors, though the named-import ban catches
`import { decode } from "effect/Schema"`. `Effect.promise` is flagged
everywhere, with no allowlist. The import rule matches directory names in the
specifier (`**/features/**`), so a path that does not name the layer escapes
it. Fixtures in `lint-fixtures/` (run by `test/lint/fixtures.test.ts`) prove
each group can fail; they do not prove the list is complete.

## Considered and declined

- oxlint and biome: see above.
