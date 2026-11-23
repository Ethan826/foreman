// The ledger directory of a target in force (owner finding F8,
// dogfood-2): the recorded ledger file's actual parent, the part of its
// path before the last `/`, whatever the file is named, since the binding
// decoder accepts any path.
import { describe, expect, it } from "@effect/vitest"
import { ProjectId } from "../../src/domain/ids.ts"
import type { TargetBinding } from "../../src/domain/target.ts"
import { ledgerDirOfTarget } from "../../src/program/production-target.ts"

const target: TargetBinding = {
  projectId: ProjectId.make("alpha"),
  ownerCheckout: "/projects/current/repo",
  supervisor: { path: "/projects/current/worktree", name: "t" },
  ledger: "/projects/current/ledger/ledger.sqlite",
  attributeAllowance: { rootLines: [] },
}

describe("ledgerDirOfTarget", () => {
  it("is the directory of a ledger file named ledger.sqlite", () => {
    expect(ledgerDirOfTarget(target)).toBe("/projects/current/ledger")
  })

  it("is the actual parent of a recorded ledger file with another name", () => {
    expect(ledgerDirOfTarget({ ...target, ledger: "/projects/current/ledger/other.sqlite" })).toBe(
      "/projects/current/ledger",
    )
  })

  it("is the root for a ledger file at the top level", () => {
    expect(ledgerDirOfTarget({ ...target, ledger: "/ledger.sqlite" })).toBe("/")
  })
})
