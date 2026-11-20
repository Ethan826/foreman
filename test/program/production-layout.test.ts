// The layout through the production composition (batch review B05;
// design "Supervisor worktree"): the state directory and the supervisor
// worktree lie outside the owner's checkout, and the state directory
// (which holds Claude's profile) and the ledger lie outside the
// supervisor worktree, the client's writable area. Paths are compared
// with every symbolic link resolved, the nearest existing ancestor
// standing in for a path not made yet. A refused layout opens no store,
// makes no git HOME, runs no git command and leaves the owner's files as
// they were.
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { existsSync, mkdirSync, readdirSync, symlinkSync } from "node:fs"
import { git } from "../runtime/git-repo.ts"
import {
  cli,
  configOf,
  endToEndMillis,
  failureTag,
  type Layout,
  succeeded,
  withLayout,
  writeConfig,
} from "./production-harness.ts"

/** What the owner's checkout holds: its top-level names and git's status, ignored files included. */
const ownerFiles = (layout: Layout) =>
  Effect.map(git(layout.owner, "status", "--porcelain", "--ignored"), (status) => ({
    names: readdirSync(layout.owner).sort(),
    status,
  }))

/** A layout `arrange` prepares, given as the configuration, refused before anything is made. */
const refusedLayout = (arrange: (layout: Layout) => { readonly stateDir: string; readonly supervisor: string }) => () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      const { stateDir, supervisor } = arrange(layout)
      writeConfig(layout, configOf(layout, { stateDir, supervisor: { path: supervisor, name: "t" } }))
      const before = yield* ownerFiles(layout)
      const supervisorBefore = existsSync(supervisor)
      const run = yield* cli(layout, ["worktree", "create"])
      expect([run.status, failureTag(run)]).toEqual([1, "LayoutRefused"])
      expect(existsSync(stateDir) ? readdirSync(stateDir) : []).toEqual([])
      expect(existsSync(supervisor)).toBe(supervisorBefore)
      expect(yield* ownerFiles(layout)).toEqual(before)
    }),
  )

const stateInOwner = (layout: Layout) => {
  mkdirSync(`${layout.owner}/state`)
  return { stateDir: `${layout.owner}/state`, supervisor: layout.supervisor }
}

const supervisorInOwner = (layout: Layout) => ({ stateDir: layout.state, supervisor: `${layout.owner}/nested` })

const supervisorIsOwner = (layout: Layout) => ({ stateDir: layout.state, supervisor: layout.owner })

const stateInSupervisor = (layout: Layout) => {
  mkdirSync(layout.supervisor)
  mkdirSync(`${layout.supervisor}/state`)
  return { stateDir: `${layout.supervisor}/state`, supervisor: layout.supervisor }
}

const linkedStateInOwner = (layout: Layout) => {
  mkdirSync(`${layout.owner}/inner`)
  symlinkSync(`${layout.owner}/inner`, `${layout.root}/state-link`)
  return { stateDir: `${layout.root}/state-link`, supervisor: layout.supervisor }
}

const supervisorUnderLinkedOwner = (layout: Layout) => {
  symlinkSync(layout.owner, `${layout.root}/owner-link`)
  return { stateDir: layout.state, supervisor: `${layout.root}/owner-link/nested` }
}

const stateThroughDanglingLink = (layout: Layout) => {
  symlinkSync(`${layout.root}/not-yet`, `${layout.root}/dangling`)
  return { stateDir: `${layout.root}/dangling/state`, supervisor: layout.supervisor }
}

const stateUnderSupervisorAddedLater = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* succeeded(layout, ["worktree", "create"])
      symlinkSync(layout.supervisor, `${layout.root}/into-worktree`)
      writeConfig(layout, configOf(layout, { stateDir: `${layout.root}/into-worktree` }))
      const run = yield* cli(layout, ["status"])
      expect([run.status, failureTag(run)]).toEqual([1, "LayoutRefused"])
      expect(readdirSync(layout.supervisor).sort()).toEqual([".git"])
    }),
  )

const unnormalizedRefused = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      for (const stateDir of [`${layout.root}/x/../state`, `${layout.root}/./state`, `${layout.state}/`, `${layout.root}//state`]) {
        writeConfig(layout, configOf(layout, { stateDir }))
        const run = yield* cli(layout, ["worktree", "create"])
        expect([run.status, failureTag(run)]).toEqual([1, "ConfigUndecodable"])
      }
    }),
  )

describe("the layout in production", () => {
  it.effect("a state directory inside the owner's checkout is refused", refusedLayout(stateInOwner), endToEndMillis)
  it.effect("a supervisor worktree inside the owner's checkout is refused", refusedLayout(supervisorInOwner), endToEndMillis)
  it.effect("a supervisor worktree at the owner's checkout is refused", refusedLayout(supervisorIsOwner), endToEndMillis)
  it.effect("a state directory inside the supervisor worktree is refused", refusedLayout(stateInSupervisor), endToEndMillis)
  it.effect("a state directory linked into the owner's checkout is refused", refusedLayout(linkedStateInOwner), endToEndMillis)
  it.effect("a supervisor path under a link to the owner's checkout is refused", refusedLayout(supervisorUnderLinkedOwner), endToEndMillis)
  it.effect("a path through a dangling link is refused", refusedLayout(stateThroughDanglingLink), endToEndMillis)
  it.effect("a state directory linked into the existing worktree is refused, even for status", stateUnderSupervisorAddedLater, endToEndMillis)
  it.effect("a path with `.`, `..`, a doubled or a trailing slash is refused at decoding", unnormalizedRefused, endToEndMillis)
})
