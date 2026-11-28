// The preflight's directory listing (review finding B08): each entry's
// name and its kind by `lstat`, never through a link, sorted by name; a
// directory that cannot be listed is reported with the failure's message,
// never as an empty listing.
import { describe, expect, it } from "@effect/vitest"
import { Effect, Match } from "effect"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { FileKinds } from "../../src/domain/attributes.ts"
import { DirectoryListed, listDirectory, type DirectoryReading } from "../../src/runtime/worktree-walk.ts"
import { withUnsearchable } from "./git-repo.ts"

/** Runs `use` with a fresh temporary directory, removed afterwards. */
const withTemporaryDirectory = <A, E>(use: (dir: string) => Effect.Effect<A, E>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => mkdtempSync(`${tmpdir()}/tarlatan-walk-`)),
    use,
    (dir) =>
      Effect.sync(() => {
        rmSync(dir, { recursive: true, force: true })
      }),
  )

/**
 * The time budget, in milliseconds, of the test that starts `mkfifo`
 * (dogfood-6e, owner ruling of 2026-11-27). It claims nothing about
 * speed; a process start took seconds while other sessions kept the load
 * average between 75 and 200.
 *
 * What it bounds: one `mkfifo` start; no git and no `ps`. Idle duration:
 * awaiting the coordinator's measurement on the dogfood-6f snapshot; this
 * file is not among the measurements of 2026-11-28.
 */
const fifoMillis = 15_000

/** Every kind in one directory: listed with its kind, sorted by name. */
const listsEveryKind = (dir: string) =>
  Effect.gen(function* () {
    mkdirSync(`${dir}/sub`)
    writeFileSync(`${dir}/b.txt`, "b\n")
    symlinkSync("sub", `${dir}/a-link`)
    symlinkSync("missing", `${dir}/dangling`)
    expect(spawnSync("/usr/bin/mkfifo", [`${dir}/pipe`], { encoding: "utf8" }).status).toBe(0)
    const listed = yield* listDirectory(dir)
    expect(listed).toEqual(
      new DirectoryListed({
        children: [
          { name: "a-link", kind: FileKinds.SymbolicLink },
          { name: "b.txt", kind: FileKinds.File },
          { name: "dangling", kind: FileKinds.SymbolicLink },
          { name: "pipe", kind: FileKinds.Other },
          { name: "sub", kind: FileKinds.Directory },
        ],
      }),
    )
  })

/** The reason of an unlisted directory, or `listed`. */
const reasonOf = (reading: DirectoryReading) =>
  Match.valueTags(reading, {
    DirectoryListed: () => "listed",
    DirectoryUnlisted: (unlisted) => unlisted.reason,
  })

/** An unsearchable directory: unlisted, with the error's reason. */
const unlistedWhenUnsearchable = (dir: string) =>
  Effect.gen(function* () {
    mkdirSync(`${dir}/sealed`)
    const listed = yield* withUnsearchable(`${dir}/sealed`, listDirectory(`${dir}/sealed`))
    expect(reasonOf(listed)).toContain("EACCES")
  })

describe("listDirectory", () => {
  it.effect("names each entry with its kind, links and FIFOs not followed, sorted by name", () =>
    withTemporaryDirectory(listsEveryKind), fifoMillis)

  it.effect("reports a directory it cannot list as unlisted with the reason", () =>
    withTemporaryDirectory(unlistedWhenUnsearchable))
})
