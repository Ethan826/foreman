import { Schema } from "effect"

export const Suits = { Hearts: "hearts", Spades: "spades" } as const
const suitNames = ["hearts", "spades"] as const

export const SuitFromTuple = Schema.Literals(suitNames)
export const SuitFromObject = Schema.Literals([Suits.Hearts, Suits.Spades])
export const Hearts = Schema.Literal(Suits.Hearts)
