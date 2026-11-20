// The two fixed permission profiles (plan "Profiles, environment and
// briefs", decision P4): the exact argv each builds from a brief, with no
// bypass flag and no session reuse for either client.
import { describe, expect, it } from "@effect/vitest"
import { Clients } from "../../src/domain/clients.ts"
import { claudeEditingArgv, codexReviewArgv } from "../../src/domain/profiles.ts"

const brief = "Implement the task in task.md."

/** Flags that bypass permissions or approvals, or reuse a prior session. */
const forbidden = [
  "--dangerously-skip-permissions",
  "--allow-dangerously-skip-permissions",
  "bypassPermissions",
  "--dangerously-bypass-approvals-and-sandbox",
  "--full-auto",
  "--yolo",
  "danger-full-access",
  "--resume",
  "--continue",
  "resume",
]

const claude = claudeEditingArgv({ brief, settingsFile: "/state/claude-settings.json" })
const codex = codexReviewArgv({ brief, lastMessageFile: "/state/op-1.last.txt" })

describe("claudeEditingArgv", () => {
  it("is exactly the editing profile's argv, executable first", () => {
    expect(claude).toEqual([
      Clients.Claude,
      "-p",
      brief,
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "dontAsk",
      "--settings",
      "/state/claude-settings.json",
    ])
  })

  it("holds no bypass or resume flag", () => {
    expect(claude.filter((arg) => forbidden.includes(arg))).toEqual([])
  })
})

describe("codexReviewArgv", () => {
  it("is exactly the read-only review profile's argv, executable first, brief last", () => {
    expect(codex).toEqual([
      Clients.Codex,
      "exec",
      "--sandbox",
      "read-only",
      "-c",
      'approval_policy="never"',
      "--json",
      "--output-last-message",
      "/state/op-1.last.txt",
      brief,
    ])
  })

  it("holds no bypass or resume flag", () => {
    expect(codex.filter((arg) => forbidden.includes(arg))).toEqual([])
  })
})
