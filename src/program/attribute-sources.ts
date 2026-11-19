// The attribute check's wiring (plan B11c, option A; owner rulings 3 and
// 4 of 2026-11-19): Runtime lists the revision's tree, reads each
// `.gitattributes` blob, reads `<commonDir>/info/attributes` and the
// `core.attributesFile` setting; Format decodes the listing; Features
// selects the entries to read and judges the whole reading. Creation runs
// it before `git worktree add` and the startup check against the recorded
// revision, both through the one clean runner of `worktreeProgramWith`.
import { Array as Arr, Effect, Match, Option } from "effect"
import type { AttributesEntryRead, TreeEntry, TreeReading } from "../domain/attributes.ts"
import { TreeListed } from "../domain/attributes.ts"
import type { Revision } from "../domain/ids.ts"
import { checkAttributeSources, isAttributesEntry, isRegularBlob } from "../features/attribute-sources.ts"
import { decodeTreeRun } from "../format/tree-listing.ts"
import {
  infoAttributesPath,
  listTreeWith,
  readAttributesFileSettingWith,
  readBlobWith,
  readFileAt,
} from "../runtime/attribute-sources.ts"
import type { RunGit } from "../runtime/git.ts"

/** Where the attribute check runs: a directory of the repository and its common directory. */
export interface AttributeCheckSite {
  /** The directory git runs in: the owner's checkout, or the recorded common directory. */
  readonly cwd: string
  /** The repository's common git directory, which holds `info/attributes`. */
  readonly commonDir: string
}

/**
 * The attribute check over an injected git runner: succeeds with
 * `revision` when Features passes the reading, and fails with
 * `AttributeSourcesRefused` listing every refusal otherwise. A git run's
 * non-zero exit and an undecodable listing are refusals; it fails with
 * `GitCommandFailed` only when git could not start.
 */
export const checkAttributeSourcesWith = (run: RunGit) =>
  Effect.fn("checkAttributeSources")(function* (site: AttributeCheckSite, revision: Revision) {
    const tree = yield* treeReadingOf(run, site.cwd, revision)
    const path = infoAttributesPath(site.commonDir)
    const reading = yield* readFileAt(path)
    const attributesFile = yield* readAttributesFileSettingWith(run)(site.cwd)
    return yield* Effect.fromResult(
      checkAttributeSources({ revision, tree, infoAttributes: { path, reading }, attributesFile }),
    )
  })

/** The listing decoded, with every `.gitattributes` entry read when the tree was listed. */
const treeReadingOf = (run: RunGit, cwd: string, revision: Revision) =>
  Effect.flatMap(listTreeWith(run)(cwd, revision), (listing) =>
    Match.valueTags(decodeTreeRun(listing), {
      TreeEntries: (decoded) => entriesRead(run, cwd, decoded.entries),
      TreeNotListed: (failed): Effect.Effect<TreeReading> => Effect.succeed(failed),
      TreeUndecodable: (failed): Effect.Effect<TreeReading> => Effect.succeed(failed),
    }),
  )

/** Each `.gitattributes` entry with its blob read when it is a regular blob. */
const entriesRead = (run: RunGit, cwd: string, entries: ReadonlyArray<TreeEntry>) =>
  Effect.map(
    Effect.forEach(Arr.filter(entries, isAttributesEntry), entryRead(run, cwd)),
    (files): TreeReading => new TreeListed({ files }),
  )

/** One entry and its `cat-file`, or none for an entry that is not a regular blob. */
const entryRead = (run: RunGit, cwd: string) => (entry: TreeEntry) =>
  isRegularBlob(entry)
    ? Effect.map(readBlobWith(run)(cwd, entry.object), (blob): AttributesEntryRead => ({ entry, blob: Option.some(blob) }))
    : Effect.succeed<AttributesEntryRead>({ entry, blob: Option.none() })
