// The client environment (plan "Profiles, environment and briefs",
// decision P2): the parent's environment with every variable whose name
// starts with `GIT_` removed, and nothing else changed.
import { describe, expect, it } from "@effect/vitest"
import { clientEnvironment } from "../../src/features/client-environment.ts"

describe("clientEnvironment", () => {
  it("removes every variable whose name starts with GIT_", () => {
    expect(
      clientEnvironment({
        PATH: "/usr/bin:/bin",
        GIT_DIR: "/repo/.git",
        GIT_WORK_TREE: "/repo",
        GIT_INDEX_FILE: "/repo/.git/index",
        GIT_: "bare prefix",
        HOME: "/home/owner",
      }),
    ).toEqual({ PATH: "/usr/bin:/bin", HOME: "/home/owner" })
  })

  it("keeps a variable that only contains GIT_ or differs in case", () => {
    const parent = { MY_GIT_DIR: "/x", git_dir: "/y", GITHUB_TOKEN: "z", GIT: "w" }
    expect(clientEnvironment(parent)).toEqual(parent)
  })

  it("keeps values exactly, including empty ones", () => {
    expect(clientEnvironment({ EMPTY: "", SPACED: " a b " })).toEqual({ EMPTY: "", SPACED: " a b " })
  })

  it("is empty for an empty parent", () => {
    expect(clientEnvironment({})).toEqual({})
  })
})
