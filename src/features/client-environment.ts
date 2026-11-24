// The environment every client process gets (plan "Profiles, environment
// and briefs", owner decision P2): the parent's environment with every
// `GIT_*` variable removed, so a `GIT_DIR`, `GIT_WORK_TREE`,
// `GIT_INDEX_FILE` or any other git setting in tarlatan's own environment
// cannot redirect the client's git commands. Names are compared exactly
// as given; git reads only the upper-case names.
import { Record, String } from "effect"

/** The prefix of the variables git reads from the environment. */
const gitPrefix = "GIT_"

/**
 * The parent environment minus every variable whose name starts with
 * `GIT_` (decision P2). Every other variable, and every value, passes
 * through unchanged; nothing is added.
 */
export const clientEnvironment = (parent: Readonly<Record<string, string>>): Readonly<Record<string, string>> =>
  Record.filter(parent, isNotGitVariable)

/** Whether a variable, by its name, is not one of git's. */
const isNotGitVariable = (_value: string, name: string): boolean => !String.startsWith(gitPrefix)(name)
