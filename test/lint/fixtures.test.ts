// Gate integrity for the lint rules (skill gate-integrity): each rule group
// has a must-fail fixture under lint-fixtures/ that has to produce the named
// rule, and the clean controls have to pass. A fixture missing from the
// manifest fails the test, so a new fixture cannot sit unchecked.
import { expect, layer } from "@effect/vitest"
import { Context, Effect, Layer } from "effect"
import { ESLint } from "eslint"
import { AttributeRefusalReasons, AttributeSources, FileKinds, TreeEntryTypes } from "../../src/domain/attributes.ts"
import { Clients } from "../../src/domain/clients.ts"
import { Roles } from "../../src/domain/roles.ts"
import { Attestations, CloseKinds } from "../../src/domain/session.ts"
import { WorktreeConditions } from "../../src/domain/worktree.ts"

interface Expected {
  readonly ruleId: string
  readonly message?: string
  readonly line?: number // where one file holds several cases
}

// Each native method must be reported by name, so dropping one from the
// rule's list fails this test. The lists are written out here on purpose,
// apart from eslint.rules.js.
const restricted = (
  methods: ReadonlyArray<string>,
): ReadonlyArray<Expected> =>
  methods.map((method) => ({
    ruleId: "no-restricted-properties",
    message: `'${method}' is restricted`,
  }))

// R7: each closed name, from Domain apart from eslint.rules.js, has its own
// fixture line and report there, so dropping one from `closedNames` fails.
const closedNames = [
  Clients, Roles, WorktreeConditions, TreeEntryTypes, FileKinds, AttributeSources, AttributeRefusalReasons,
  CloseKinds, Attestations,
]
  .flatMap((vocabulary): ReadonlyArray<string> => Object.values(vocabulary))
const bareNamesText = Object.values(
  import.meta.glob<string>("../../lint-fixtures/src/features/bare-names.ts", { query: "?raw", import: "default", eager: true }),
).join("")
/** The 1-based line of the bare-names fixture holding `fragment`, or 0 when none does. */
const fixtureLine = (fragment: string) => bareNamesText.split("\n").findIndex((line) => line.includes(fragment)) + 1
/** The line that spells `name` as a value: `export const nameNN = "<name>"`. */
const nameLine = (name: string) => fixtureLine(`= "${name}"`)
const bareName = (line: number): Expected => ({ ruleId: "no-restricted-syntax", message: "closed vocabulary", line })
const mustFail: Record<string, ReadonlyArray<Expected>> = {
  "src/domain/native-array-iterate.ts": restricted([
    "map", "filter", "some", "every", "find", "findIndex", "findLast",
    "findLastIndex", "reduce", "reduceRight", "flatMap", "flat", "forEach",
  ]),
  "src/features/native-array-access.ts": restricted([
    "includes", "indexOf", "lastIndexOf", "slice", "concat", "join", "sort",
    "toSorted", "reverse", "toReversed", "at", "fill", "splice", "toSpliced",
  ]),
  "src/format/native-string.ts": restricted([
    "split", "trim", "trimStart", "trimEnd", "toLowerCase", "toUpperCase",
    "startsWith", "endsWith", "replace", "replaceAll", "padStart", "padEnd",
    "substring", "charAt", "repeat", "localeCompare", "normalize",
  ]),
  "src/domain/native-object.ts": [
    { ruleId: "no-restricted-properties", message: "'Object.keys'" },
    { ruleId: "no-restricted-properties", message: "'Object.entries'" },
  ],
  "src/domain/native-evasions.ts": restricted(["map", "filter"]),
  "src/domain/native-set.ts": [{ ruleId: "no-restricted-syntax", message: "Native Set and Map" }],
  "src/domain/eq-undefined.ts": [{ ruleId: "no-restricted-syntax", message: "Comparing with undefined" }],
  "src/domain/ne-undefined.ts": [{ ruleId: "no-restricted-syntax", message: "Comparing with undefined" }],
  "src/domain/eq-null.ts": [{ ruleId: "no-restricted-syntax", message: "Comparing with null" }],
  "src/domain/ne-null.ts": [{ ruleId: "no-restricted-syntax", message: "Comparing with null" }],
  "src/domain/loose-null.ts": [{ ruleId: "no-restricted-syntax", message: "Comparing with null" }],
  "src/domain/typeof-undefined.ts": [{ ruleId: "no-restricted-syntax", message: "typeof comparisons" }],
  "src/domain/nullish-coalesce.ts": [{ ruleId: "no-restricted-syntax", message: "?? on a nullable" }],
  "src/features/optional-chain.ts": [{ ruleId: "no-restricted-syntax", message: "Optional chaining" }],
  "src/domain/cast.ts": [{ ruleId: "@typescript-eslint/consistent-type-assertions" }],
  "src/domain/nonnull.ts": [{ ruleId: "@typescript-eslint/no-non-null-assertion" }],
  "src/domain/throw.ts": [
    { ruleId: "functional/no-throw-statements" },
    { ruleId: "no-restricted-syntax", message: "throw" },
  ],
  "src/domain/try.ts": [{ ruleId: "no-restricted-syntax", message: "try/catch" }],
  "src/domain/loop.ts": [
    { ruleId: "functional/no-loop-statements" },
    { ruleId: "no-restricted-syntax", message: "for...of" },
  ],
  "src/domain/while.ts": [{ ruleId: "functional/no-loop-statements" }],
  "src/domain/let.ts": [{ ruleId: "functional/no-let" }],
  "src/domain/mutate.ts": [{ ruleId: "functional/immutable-data" }],
  "src/domain/magic-numbers.ts": [
    { ruleId: "@typescript-eslint/no-magic-numbers", message: "No magic number: 3" },
    { ruleId: "@typescript-eslint/no-magic-numbers", message: "No magic number: 10" },
    { ruleId: "@typescript-eslint/no-magic-numbers", message: "No magic number: 60_000" },
  ],
  "src/domain/nested-callbacks.ts": [{ ruleId: "max-nested-callbacks", message: "Too many nested callbacks (4)" }],
  "src/domain/parse.ts": [{ ruleId: "no-restricted-syntax", message: "JSON" }],
  "src/features/async.ts": [
    { ruleId: "no-restricted-syntax", message: "async" },
    { ruleId: "no-restricted-syntax", message: "await" },
    { ruleId: "no-restricted-syntax", message: "Promise" },
  ],
  "src/features/schema-decode.ts": [
    { ruleId: "no-restricted-syntax", message: "Schema.decode" },
  ],
  "src/features/schema-sync.ts": [
    { ruleId: "no-restricted-syntax", message: "Schema.decode" },
  ],
  "src/features/run.ts": [{ ruleId: "no-restricted-syntax", message: "running them" }],
  "src/features/function-style.ts": [{ ruleId: "func-style" }],
  "src/domain/import-up.ts": [{ ruleId: "no-restricted-imports", message: "domain may import only nothing" }],
  "src/domain/import-node.ts": [{ ruleId: "no-restricted-imports", message: "effect and nothing else" }],
  "src/features/import-format.ts": [{ ruleId: "no-restricted-imports", message: "features may import only domain" }],
  "src/format/import-features.ts": [{ ruleId: "no-restricted-imports", message: "format may import only domain" }],
  "src/runtime/import-format.ts": [{ ruleId: "no-restricted-imports", message: "runtime may import only domain" }],
  "src/facade/import-runtime.ts": [{ ruleId: "no-restricted-imports", message: "facade may import only" }],
  "src/domain/literals-inline-array.ts": [
    { ruleId: "no-restricted-syntax", message: "Schema.Literals" },
  ],
  "src/format/literal-inline.ts": [
    { ruleId: "no-restricted-syntax", message: "Schema.Literal takes" },
  ],
  "src/features/bare-names.ts": [
    ...closedNames.map((name) => bareName(nameLine(name))),
    bareName(fixtureLine("export type Reviewer")),
  ],
  "test/bare-names.ts": [
    { ruleId: "no-restricted-syntax", message: "closed vocabulary" },
  ],
  "test/cast.ts": [{ ruleId: "@typescript-eslint/consistent-type-assertions" }],
  "test/schema-decode.ts": [{ ruleId: "no-restricted-syntax", message: "Schema.decode" }],
  "test/run-sync.ts": [{ ruleId: "no-restricted-syntax", message: "running them" }],
  "test/runtime/fixtures/other-child.ts": [{ ruleId: "no-restricted-syntax", message: "running them" }],
  "test/runtime/fixtures/hold-lock.ts": [{ ruleId: "no-restricted-syntax", message: "running them" }],
}

const clean: ReadonlyArray<string> = [
  "src/domain/ok.ts",
  "src/domain/control.ts",
  "src/domain/literals-named.ts",
  "src/domain/clients.ts",
  "src/domain/attributes.ts",
  "src/domain/roles.ts",
  "src/features/names-ok.ts",
  "src/domain/effect-modules.ts",
  "src/runtime/native-ok.ts",
  "src/format/ok.ts",
  "test/relaxed.ts",
]

// vitest runs from the repository root; no @types/node is installed.
declare const process: { cwd: () => string }
const fixtureRoot = `${process.cwd()}/lint-fixtures`

class LintFailed extends Error {}

// The fixtures are linted once and the result shared by every test below.
// Linting them once per test broke in CI: CI=true puts typescript-eslint in
// single-run mode, which treats a second parse of the same file in one
// process as an autofix pass and parses it in an isolated program without
// lint-fixtures/tsconfig.json (no strict, no lib, no `effect` types).
class LintedFixtures extends Context.Service<
  LintedFixtures,
  Readonly<Record<string, ESLint.LintResult>>
>()("LintedFixtures") {}

const lintFixtures = Effect.gen(function* () {
  const eslint = new ESLint({ cwd: fixtureRoot })
  const results = yield* Effect.tryPromise({
    try: () => eslint.lintFiles(["src/**/*.ts", "test/**/*.ts"]),
    catch: (cause) => new LintFailed("eslint did not run", { cause }),
  })
  return Object.fromEntries(
    results.map((result) => [result.filePath.slice(fixtureRoot.length + 1), result]),
  )
})

const lintedFixtures = Layer.effect(LintedFixtures, lintFixtures)

type Linted = Readonly<Record<string, ESLint.LintResult>>

// The checks below are named helpers so the tests stay within the nesting
// limit (max-nested-callbacks).
const isReported = (result: ESLint.LintResult | undefined, want: Expected): boolean =>
  (result?.messages ?? []).some(
    (found) =>
      found.ruleId === want.ruleId &&
      (want.message === undefined || found.message.includes(want.message)) &&
      (want.line === undefined || found.line === want.line),
  )

const missingIn = (linted: Linted): ReadonlyArray<string> =>
  Object.entries(mustFail).flatMap(([file, expected]) =>
    expected.flatMap((want) =>
      isReported(linted[file], want) ? [] : [`${file}:${String(want.line ?? "")} ${want.ruleId} ${want.message ?? ""}`],
    ),
  )

const parseErrorsIn = (linted: Linted): ReadonlyArray<string> =>
  Object.entries(linted).flatMap(([file, result]) =>
    result.messages
      .filter((found) => found.ruleId === null)
      .map((found) => `${file}:${String(found.line)}: ${found.message}`),
  )

const reportedIn = (linted: Linted): ReadonlyArray<string> =>
  Object.entries(mustFail).flatMap(([file]) =>
    (linted[file]?.messages ?? []).map((found) => `${file}: ${found.ruleId ?? "parse"}: ${found.message}`),
  )

const dirtyIn = (linted: Linted): ReadonlyArray<string> =>
  clean.flatMap((file) => {
    const result = linted[file]
    return result === undefined
      ? [`${file}: not linted`]
      : result.messages.map(
          (found) => `${file}:${String(found.line)}: ${found.ruleId ?? "parse"}: ${found.message}`,
        )
  })

layer(lintedFixtures, { timeout: 120_000 })("lint fixtures", (it) => {
  it("each closed vocabulary name has its own line in the bare-names fixture", () => {
    const lines = closedNames.map(nameLine)
    expect({ unlisted: lines.filter((line) => line === 0), distinct: new Set(lines).size }).toEqual({ unlisted: [], distinct: 29 })
  })
  it.effect("every fixture is a listed must-fail or a listed clean control", () =>
    Effect.gen(function* () {
      const found = Object.keys(yield* LintedFixtures).sort()
      expect(found).toEqual([...Object.keys(mustFail), ...clean].sort())
    }),
    120_000,
  )

  it.effect("each must-fail fixture reports its expected rule, and no parse error", () =>
    Effect.gen(function* () {
      const linted = yield* LintedFixtures
      const missing = missingIn(linted)
      const parseErrors = parseErrorsIn(linted)
      const reported = reportedIn(linted)
      expect({ missing, reported: missing.length === 0 ? [] : reported }).toEqual({
        missing: [],
        reported: [],
      })
      expect(parseErrors).toEqual([])
    }),
    120_000,
  )

  it.effect("each clean control reports nothing", () =>
    Effect.gen(function* () {
      const linted = yield* LintedFixtures
      const dirty = dirtyIn(linted)
      expect(dirty).toEqual([])
    }),
    120_000,
  )
})
