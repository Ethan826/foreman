// Test helper: set one variable in this test process's environment for
// the length of one effect and restore it afterwards (accepted by the
// owner, 2026-11-18: tests in a file run one at a time, and each file has
// its own worker process). Used to plant a hostile parent environment for
// the clean and pinned git runners.
import { Effect } from "effect"

/** The parent variables tests may set, each unset again by a static delete. */
const unsetters = {
  HOME: () => {
    delete process.env.HOME
  },
  GIT_CONFIG_GLOBAL: () => {
    delete process.env.GIT_CONFIG_GLOBAL
  },
  GIT_DIR: () => {
    delete process.env.GIT_DIR
  },
  GIT_WORK_TREE: () => {
    delete process.env.GIT_WORK_TREE
  },
  GIT_COMMON_DIR: () => {
    delete process.env.GIT_COMMON_DIR
  },
  FOREMAN_PARENT_ONLY: () => {
    delete process.env.FOREMAN_PARENT_ONLY
  },
}

/** A variable of the parent environment that tests may set. */
export type ParentVariable = keyof typeof unsetters

/**
 * Runs `use` with one variable set in this process's environment, and
 * restores it (or unsets it, if it was unset) afterwards.
 */
export const withParentEnvironment = <A, E>(name: ParentVariable, value: string, use: Effect.Effect<A, E>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const saved = process.env[name]
      process.env[name] = value
      return saved
    }),
    () => use,
    (saved) =>
      Effect.sync(() => {
        if (saved === undefined) unsetters[name]()
        else process.env[name] = saved
      }),
  )
