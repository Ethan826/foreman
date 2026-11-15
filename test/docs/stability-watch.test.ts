// Tripwire for Effect's unstable durable-workflow modules.
//
// The owner accepted building on `effect/workflow` and `effect/cluster`
// (2026-11-15) although effect 4.1.x marks them `@stability unstable`.
// This test reads the module-level doc comment of every module in those two
// folders from the installed effect and compares the `@stability` and
// `@since` tags, the module set and the effect version with
// docs/stability-watch.json. Any difference fails, so the decision is
// revisited when it changes.
//
// The module doc comment is the first `/** ... */` block of the file,
// before any code. Member-level `@stability` tags are not read.
//
// Blind spots. It reads installed source, so it sees a change only after
// `bun install` brings in a new effect (a lockfile bump). It does not
// notice a change of stability inside a module that no longer says
// "unstable" in its first doc block, other than as a failure to parse the
// tag. It does not cover other Effect folders (`unstable/*` subpaths, for
// example) or other packages. If the files cannot be found at all, the test
// fails; it never passes on an empty scan.
import { describe, expect, it } from "@effect/vitest"
import recorded from "../../docs/stability-watch.json"

const sources = import.meta.glob<string>(
  [
    "../../node_modules/effect/src/workflow/*.ts",
    "../../node_modules/effect/src/cluster/*.ts",
  ],
  { query: "?raw", import: "default", eager: true },
)
const manifests = import.meta.glob<string>(
  "../../node_modules/effect/package.json",
  { query: "?raw", import: "default", eager: true },
)

interface Tags {
  readonly stability: string
  readonly since: string
}

const MISSING = "(tag missing)"

export const moduleTags = (text: string): Tags => {
  const doc = /^\s*\/\*\*([\s\S]*?)\*\//.exec(text)?.[1] ?? ""
  return {
    stability: /@stability\s+(\S+)/.exec(doc)?.[1] ?? MISSING,
    since: /@since\s+(\S+)/.exec(doc)?.[1] ?? MISSING,
  }
}

export const installedVersion = (manifest: string): string =>
  /"version"\s*:\s*"([^"]+)"/.exec(manifest)?.[1] ?? MISSING

const moduleName = (path: string): string =>
  path.replace(/^.*\/src\//, "").replace(/\.ts$/, "")

const installed = (): Readonly<Record<string, Tags>> =>
  Object.fromEntries(
    Object.entries(sources).map(([path, text]) => [
      moduleName(path),
      moduleTags(text),
    ]),
  )

const recordedModules: Readonly<Record<string, Tags>> = recorded.modules

const advice =
  "Update docs/stability-watch.json and the effect/workflow and effect/cluster " +
  "entry in docs/dependency-intake.md, and tell the owner: their decision to " +
  "build on these modules was made while they were unstable."

export const differences = (
  version: string,
  now: Readonly<Record<string, Tags>>,
  before: Readonly<Record<string, Tags>>,
  beforeVersion: string,
): ReadonlyArray<string> => [
  ...(Object.keys(now).length === 0
    ? ["read zero modules from node_modules/effect/src (path moved?)"]
    : []),
  ...(version === beforeVersion
    ? []
    : [`effect version is ${version}, recorded ${beforeVersion}`]),
  ...Object.keys(now)
    .filter((name) => !(name in before))
    .map((name) => `module appeared: ${name}`),
  ...Object.keys(before)
    .filter((name) => !(name in now))
    .map((name) => `module disappeared: ${name}`),
  ...Object.keys(now).flatMap((name) => {
    const was = before[name]
    const is = now[name]
    return was === undefined || is === undefined
      ? []
      : [
          ...(was.stability === is.stability
            ? []
            : [`${name}: stability ${was.stability} -> ${is.stability}`]),
          ...(was.since === is.since
            ? []
            : [`${name}: since ${was.since} -> ${is.since}`]),
        ]
  }),
]

describe("Effect stability watch", () => {
  it("installed effect matches docs/stability-watch.json", () => {
    const found = differences(
      installedVersion(Object.values(manifests)[0] ?? ""),
      installed(),
      recordedModules,
      recorded.effectVersion,
    )
    expect(found, `${advice}\n${found.join("\n")}`).toEqual([])
  })

  it("records modules and reads the real tree", () => {
    expect(Object.keys(recordedModules).length).toBeGreaterThanOrEqual(40)
    expect(Object.keys(installed()).length).toBeGreaterThanOrEqual(40)
    expect(installed()["workflow/Workflow"]?.stability).toBe("unstable")
    expect(installed()["cluster/SingleRunner"]?.stability).toBe("unstable")
  })
})

describe("the watch detects what it covers", () => {
  const base = { "a/X": { stability: "unstable", since: "4.0.0" } }
  it("passes on equal input", () => {
    expect(differences("1", base, base, "1")).toEqual([])
  })
  it("flags a stability change", () => {
    expect(
      differences("1", { "a/X": { stability: "stable", since: "4.0.0" } }, base, "1"),
    ).toEqual(["a/X: stability unstable -> stable"])
  })
  it("flags an appearing and a disappearing module", () => {
    expect(differences("1", { ...base, "a/Y": base["a/X"] }, base, "1")).toEqual([
      "module appeared: a/Y",
    ])
    expect(differences("1", {}, base, "1")).toEqual([
      "read zero modules from node_modules/effect/src (path moved?)",
      "module disappeared: a/X",
    ])
  })
  it("flags a version change", () => {
    expect(differences("2", base, base, "1")).toEqual([
      "effect version is 2, recorded 1",
    ])
  })
  it("reads tags from the first doc block only", () => {
    expect(
      moduleTags("/**\n * x\n * @stability stable\n * @since 4.2.0\n */\n/** @stability unstable */"),
    ).toEqual({ stability: "stable", since: "4.2.0" })
    expect(moduleTags("import x\n/** @stability stable */").stability).toBe(MISSING)
  })
})
