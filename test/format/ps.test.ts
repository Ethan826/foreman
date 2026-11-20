// `ps -A -o pid,pgid,lstart,command` output, decoded strictly: the
// header, then one row per process with the fixed lstart layout and a
// command that may hold spaces. Any row that does not decode fails the
// whole listing.
import { describe, expect, it } from "@effect/vitest"
import { Option, Result } from "effect"
import { decodePs, startTimeOf } from "../../src/format/ps.ts"

const header = "  PID  PGID STARTED                      COMMAND\n"
const launchd = "    1     1 Wed Sep 30 11:32:26 2026     /sbin/launchd\n"
const mail = "  282   282 Wed Nov 18 13:37:37 2026     /System/Applications/Mail.app/Contents/MacOS/Mail\n"
const spaced = " 2846  2846 Fri Oct  9 14:06:29 2026     /bin/sh -c echo  two  spaces\n"
const linuxHeader = "    PID    PGID                  STARTED COMMAND\n"
const linuxRow = "      1       1 Wed Nov 19 10:00:00 2026 /sbin/init splash\n"

describe("decodePs", () => {
  it("decodes each row in listing order", () => {
    expect(decodePs(`${header}${launchd}${mail}`)).toEqual(
      Result.succeed([
        { pid: 1, pgid: 1, startedAt: "Wed Sep 30 11:32:26 2026", command: "/sbin/launchd" },
        {
          pid: 282,
          pgid: 282,
          startedAt: "Wed Nov 18 13:37:37 2026",
          command: "/System/Applications/Mail.app/Contents/MacOS/Mail",
        },
      ]),
    )
  })

  it("keeps a padded day in the start time and spaces inside the command", () => {
    expect(decodePs(`${header}${spaced}`)).toEqual(
      Result.succeed([
        { pid: 2846, pgid: 2846, startedAt: "Fri Oct  9 14:06:29 2026", command: "/bin/sh -c echo  two  spaces" },
      ]),
    )
  })

  it("decodes procps's header and columns", () => {
    expect(decodePs(`${linuxHeader}${linuxRow}`)).toEqual(
      Result.succeed([{ pid: 1, pgid: 1, startedAt: "Wed Nov 19 10:00:00 2026", command: "/sbin/init splash" }]),
    )
  })

  it("decodes a header alone as no rows", () => {
    expect(decodePs(header)).toEqual(Result.succeed([]))
  })

  it("fails on empty output", () => {
    expect(Result.isFailure(decodePs(""))).toBe(true)
  })

  it("fails without a final newline", () => {
    expect(Result.isFailure(decodePs(`${header}${launchd}`.slice(0, -1)))).toBe(true)
  })

  it("fails without the header", () => {
    expect(Result.isFailure(decodePs(launchd))).toBe(true)
  })

  it("fails on a header with other columns", () => {
    expect(Result.isFailure(decodePs("  PID  PGID STARTED                      COMMAND  TTY\n"))).toBe(true)
  })

  it("fails on an unparsable row rather than skipping it", () => {
    const result = decodePs(`${header}${launchd}  282   282 yesterday     /bin/sh\n`)
    expect(Result.isFailure(result)).toBe(true)
    expect(Result.getFailure(result).pipe(Option.map((failure) => failure.reason))).toEqual(
      Option.some(expect.stringContaining("yesterday")),
    )
  })

  it("fails on a blank line between rows", () => {
    expect(Result.isFailure(decodePs(`${header}${launchd}\n${mail}`))).toBe(true)
  })

  it("fails on a row with no command", () => {
    expect(Result.isFailure(decodePs(`${header}    1     1 Wed Sep 30 11:32:26 2026\n`))).toBe(true)
  })

  it("fails on a pid of zero", () => {
    expect(Result.isFailure(decodePs(`${header}    0     1 Wed Sep 30 11:32:26 2026     /sbin/launchd\n`))).toBe(
      true,
    )
  })

  it("fails on a start time with a month name in lower case", () => {
    expect(Result.isFailure(decodePs(`${header}    1     1 Wed sep 30 11:32:26 2026     /sbin/launchd\n`))).toBe(
      true,
    )
  })
})

describe("startTimeOf", () => {
  it("is the start time of the row with the given pid", () => {
    expect(startTimeOf(`${header}${launchd}${mail}`, 282)).toEqual(Option.some("Wed Nov 18 13:37:37 2026"))
  })

  it("is none when no row has the pid", () => {
    expect(startTimeOf(`${header}${launchd}`, 282)).toEqual(Option.none())
  })

  it("is none when the listing does not decode", () => {
    expect(startTimeOf(`${header}${mail}bad row\n`, 282)).toEqual(Option.none())
  })
})
