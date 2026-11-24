// The byte order mark a JSON file of tarlatan's may begin with (focused
// re-review finding 2). Editors on some systems write UTF-8 with a
// leading mark, EF BB BF, and 9fee8a5 read the configuration and the
// binding with or without one. The strict UTF-8 decoder keeps the mark as
// U+FEFF, which JSON does not allow, so these two decoders drop it first.
// Exactly one mark at the very start is dropped; any other U+FEFF is text.
import { String } from "effect"

/** U+FEFF, the byte order mark once decoded. */
const byteOrderMark = "﻿"

/**
 * `text` without one leading U+FEFF, as the WHATWG UTF-8 decoder drops it
 * by default. A second mark, a mark after whitespace and a mark inside
 * the text stay, so the JSON decoder still refuses or keeps them.
 */
export const withoutByteOrderMark = (text: string): string =>
  String.startsWith(byteOrderMark)(text) ? String.slice(String.length(byteOrderMark))(text) : text
