// Gate integrity for the lint rules (skill gate-integrity): each rule group
// has a must-fail fixture under lint-fixtures/ that has to produce the named
// rule, and the clean controls have to pass. A fixture missing from the
// manifest fails the test, so a new fixture cannot sit unchecked.
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { ESLint } from "eslint"

interface Expected {
  readonly ruleId: string
  readonly message?: string
}

const mustFail: Record<string, ReadonlyArray<Expected>> = {
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
  "test/cast.ts": [{ ruleId: "@typescript-eslint/consistent-type-assertions" }],
  "test/schema-decode.ts": [{ ruleId: "no-restricted-syntax", message: "Schema.decode" }],
}

const clean: ReadonlyArray<string> = [
  "src/domain/ok.ts",
  "src/domain/control.ts",
  "src/format/ok.ts",
  "test/relaxed.ts",
]

// vitest runs from the repository root; no @types/node is installed.
declare const process: { cwd: () => string }
const fixtureRoot = `${process.cwd()}/lint-fixtures`

class LintFailed extends Error {}

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

describe("lint fixtures", () => {
  it.effect("every fixture is a listed must-fail or a listed clean control", () =>
    Effect.gen(function* () {
      const found = Object.keys(yield* lintFixtures).sort()
      expect(found).toEqual([...Object.keys(mustFail), ...clean].sort())
    }),
    120_000,
  )

  it.effect("each must-fail fixture reports its expected rule, and no parse error", () =>
    Effect.gen(function* () {
      const linted = yield* lintFixtures
      const missing = Object.entries(mustFail).flatMap(([file, expected]) =>
        expected.flatMap((want) =>
          (linted[file]?.messages ?? []).some(
            (found) =>
              found.ruleId === want.ruleId &&
              (want.message === undefined || found.message.includes(want.message)),
          )
            ? []
            : [`${file}: ${want.ruleId} ${want.message ?? ""}`],
        ),
      )
      const parseErrors = Object.values(linted).flatMap((result) =>
        result.messages.filter((found) => found.ruleId === null),
      )
      expect(missing).toEqual([])
      expect(parseErrors).toEqual([])
    }),
    120_000,
  )

  it.effect("each clean control reports nothing", () =>
    Effect.gen(function* () {
      const linted = yield* lintFixtures
      const dirty = clean.filter((file) => (linted[file]?.messages.length ?? 1) !== 0)
      expect(dirty).toEqual([])
    }),
    120_000,
  )
})
