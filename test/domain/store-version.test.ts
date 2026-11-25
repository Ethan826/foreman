// The store format version decision (dogfood-5, owner rulings P2 and
// P3): total over every 32-bit `user_version`, and no outcome lowers a
// version, since only a store that read 0 is stamped.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Schema } from "effect"
import {
  decideStoreVersion,
  invalidVersionReason,
  knownStoreVersion,
  StoreCurrent,
  StoreNewer,
  StoreUnstamped,
  StoreVersionInvalid,
} from "../../src/domain/store-version.ts"

/** The bounds of SQLite's signed 32-bit `user_version`. */
const int32Max = 2_147_483_647
const int32Min = -2_147_483_648

describe("decideStoreVersion", () => {
  it("knows format version 1", () => {
    expect(knownStoreVersion).toBe(1)
  })

  it("decides 0 as unstamped, the one outcome a writer stamps", () => {
    expect(decideStoreVersion(0)).toEqual(new StoreUnstamped())
  })

  it("decides 1 as current", () => {
    expect(decideStoreVersion(1)).toEqual(new StoreCurrent())
  })

  it("decides 2 and the 32-bit maximum as newer, with the version found", () => {
    expect(decideStoreVersion(2)).toEqual(new StoreNewer({ found: 2 }))
    expect(decideStoreVersion(int32Max)).toEqual(new StoreNewer({ found: int32Max }))
  })

  it("decides -1 and the 32-bit minimum as invalid, not newer, with the version found", () => {
    expect(decideStoreVersion(-1)).toEqual(new StoreVersionInvalid({ found: -1 }))
    expect(decideStoreVersion(int32Min)).toEqual(new StoreVersionInvalid({ found: int32Min }))
  })

  it("stamps only a store that read 0, so no decision lowers a version", () => {
    const versions = [int32Min, -1, 0, 1, 2, int32Max]
    const stamped = Arr.filter(versions, (version) => Schema.is(StoreUnstamped)(decideStoreVersion(version)))
    expect(stamped).toEqual([0])
  })

  it("gives ruling P2's reason for a negative version", () => {
    expect(invalidVersionReason(-1)).toBe("store format version -1 is not one tarlatan writes")
  })
})
