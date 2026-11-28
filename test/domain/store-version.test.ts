// The store format version decision (dogfood-5, owner rulings P2 and
// P3; v0.2.0, dogfood-6): total over every 32-bit `user_version`, decided
// per store against its own known version (the ledger 1, the log 2), and
// no outcome lowers a version, since only a store that read 0 is stamped.
// Which events raise the log is checked over every row of the golden
// encoding fixture.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Option, Record, Result, Schema } from "effect"
import {
  FindingOverruled,
  FindingsRecorded,
  ProjectEvent,
  RoundsGranted,
  RulingAdded,
  SessionClosed,
} from "../../src/domain/events.ts"
import { CloseKinds, SessionId } from "../../src/domain/session.ts"
import {
  decideStoreVersion,
  firstStoreVersion,
  invalidVersionReason,
  knownLedgerVersion,
  knownLogVersion,
  raisesLogFormat,
  StoreCurrent,
  StoreNewer,
  StoreOlderReadable,
  StoreUnstamped,
  StoreVersionInvalid,
} from "../../src/domain/store-version.ts"

/** The bounds of SQLite's signed 32-bit `user_version`. */
const int32Max = 2_147_483_647
const int32Min = -2_147_483_648

/** The known version of v0.1.1, which versioned both stores with one constant. */
const v011Known = 1

/** The fixture's text: one encoded row of every ProjectEvent member. */
const fixtureText = Option.getOrElse(
  Arr.head(
    Record.values(
      import.meta.glob<string>("../fixtures/events/encoded-events.json", {
        query: "?raw",
        import: "default",
        eager: true,
      }),
    ),
  ),
  () => "",
)

/** Every fixture row decoded as a ProjectEvent; empty when the fixture does not decode. */
const fixtureEvents = Result.getOrElse(
  Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Array(ProjectEvent)))(fixtureText),
  () => [],
)

describe("decideStoreVersion", () => {
  it("knows ledger format version 1 and log format version 2, and stamps 1", () => {
    expect(knownLedgerVersion).toBe(1)
    expect(knownLogVersion).toBe(2)
    expect(firstStoreVersion).toBe(1)
  })

  it("decides 0 as unstamped, the one outcome a writer stamps", () => {
    expect(decideStoreVersion(0, knownLedgerVersion)).toEqual(new StoreUnstamped())
  })

  it("decides 1 as current for the ledger and older readable for the log", () => {
    expect(decideStoreVersion(1, knownLedgerVersion)).toEqual(new StoreCurrent())
    expect(decideStoreVersion(1, knownLogVersion)).toEqual(new StoreOlderReadable({ found: 1 }))
  })

  it("decides 2 as newer for the ledger and current for the log", () => {
    expect(decideStoreVersion(2, knownLedgerVersion)).toEqual(new StoreNewer({ found: 2 }))
    expect(decideStoreVersion(2, knownLogVersion)).toEqual(new StoreCurrent())
  })

  it("decides 0 as unstamped and -1 as invalid for both stores", () => {
    expect(decideStoreVersion(0, knownLogVersion)).toEqual(new StoreUnstamped())
    expect(decideStoreVersion(-1, knownLedgerVersion)).toEqual(new StoreVersionInvalid({ found: -1 }))
    expect(decideStoreVersion(-1, knownLogVersion)).toEqual(new StoreVersionInvalid({ found: -1 }))
  })

  it("decides 3 as newer for the log", () => {
    expect(decideStoreVersion(3, knownLogVersion)).toEqual(new StoreNewer({ found: 3 }))
  })

  it("refuses a raised log under v0.1.1's decision", () => {
    expect(decideStoreVersion(knownLogVersion, v011Known)).toEqual(new StoreNewer({ found: 2 }))
  })

  it("decides 2 and the 32-bit maximum as newer, with the version found", () => {
    expect(decideStoreVersion(2, knownLedgerVersion)).toEqual(new StoreNewer({ found: 2 }))
    expect(decideStoreVersion(int32Max, knownLedgerVersion)).toEqual(new StoreNewer({ found: int32Max }))
  })

  it("decides -1 and the 32-bit minimum as invalid, not newer, with the version found", () => {
    expect(decideStoreVersion(-1, knownLedgerVersion)).toEqual(new StoreVersionInvalid({ found: -1 }))
    expect(decideStoreVersion(int32Min, knownLedgerVersion)).toEqual(new StoreVersionInvalid({ found: int32Min }))
  })

  it("stamps only a store that read 0, so no decision lowers a version", () => {
    const versions = [int32Min, -1, 0, 1, 2, int32Max]
    const stamped = Arr.filter(versions, (version) =>
      Schema.is(StoreUnstamped)(decideStoreVersion(version, knownLedgerVersion)),
    )
    expect(stamped).toEqual([0])
    const stampedLog = Arr.filter(versions, (version) =>
      Schema.is(StoreUnstamped)(decideStoreVersion(version, knownLogVersion)),
    )
    expect(stampedLog).toEqual([0])
  })

  it("gives ruling P2's reason for a negative version", () => {
    expect(invalidVersionReason(-1)).toBe("store format version -1 is not one tarlatan writes")
  })
})

describe("raisesLogFormat", () => {
  it("reads one event of every ProjectEvent member from the fixture", () => {
    expect(Arr.length(fixtureEvents)).toBe(Arr.length(ProjectEvent.members))
  })

  it("is true for exactly FindingsRecorded, RulingAdded, FindingOverruled and RoundsGranted, over every fixture row", () => {
    const isNewFormat = Schema.is(Schema.Union([FindingsRecorded, RulingAdded, FindingOverruled, RoundsGranted]))
    expect(Arr.map(fixtureEvents, raisesLogFormat)).toEqual(Arr.map(fixtureEvents, (event) => isNewFormat(event)))
    expect(Arr.length(Arr.filter(fixtureEvents, raisesLogFormat))).toBe(4)
  })

  it("is true for a SessionClosed exactly when its close kind is unconverged, which v0.1.1 does not decode", () => {
    const raisingKinds = Arr.filter(Record.values(CloseKinds), (how) =>
      raisesLogFormat(
        new SessionClosed({ sessionId: SessionId.make("s-1"), how, note: "closed", attests: Option.none() }),
      ),
    )
    expect(raisingKinds).toEqual([CloseKinds.Unconverged])
  })
})
