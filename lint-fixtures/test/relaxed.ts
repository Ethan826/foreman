const parsed: unknown = JSON.parse("[1]")
const items: Array<number> = []
for (const n of [1, 2]) {
  items.push(n)
}
export const all = [parsed, items]
