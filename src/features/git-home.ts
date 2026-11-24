// Whether git's HOME may be used (batch review B02; plan B11b, ruling 2):
// a real directory, not a link, owned by tarlatan's user, mode exactly
// 0700, and empty. Program creates it when nothing is there and then asks
// again; an existing directory is judged as it is and never cleared.
import { Array as Arr, Match, Result } from "effect"
import { GitHomeRefused, type HomeFound, type HomeReading } from "../domain/git-home.ts"

/** The radix of a mode as the owner reads it. */
const octal = 8

/** The only permission bits a usable HOME has: owner read, write and search. */
export const privateHomeMode = 0o700

/**
 * Passes a reading of a private, empty directory owned by tarlatan's user;
 * otherwise fails with {@link GitHomeRefused} naming every reason. An
 * absent path is refused too: Program judges only after creating it.
 */
export const judgeGitHome = (path: string, reading: HomeReading): Result.Result<void, GitHomeRefused> =>
  Arr.match(reasonsOf(reading), {
    onEmpty: () => Result.void,
    onNonEmpty: (reasons) => Result.fail(new GitHomeRefused({ path, reasons })),
  })

/** Every reason a reading cannot be used, in a fixed order. */
const reasonsOf = (reading: HomeReading): ReadonlyArray<string> =>
  Match.valueTags(reading, {
    HomeAbsent: () => ["nothing is at the path"],
    HomeUnreadable: (failed) => [`unreadable: ${failed.reason}`],
    HomeFound: foundReasons,
  })

/** The reasons a found entry cannot be used. */
const foundReasons = (found: HomeFound): ReadonlyArray<string> =>
  Arr.flatten([
    found.link ? ["is a symbolic link"] : [],
    !found.link && !found.directory ? ["is not a directory"] : [],
    found.ownerUid === found.userUid ? [] : [`is owned by uid ${String(found.ownerUid)}, not tarlatan's`],
    found.mode === privateHomeMode ? [] : [`has mode ${found.mode.toString(octal)}, not 700`],
    found.entries === 0 ? [] : [`is not empty (${String(found.entries)} entries)`],
  ])
