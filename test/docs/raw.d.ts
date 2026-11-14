/// <reference types="vite/types/importMeta.d.ts" />

declare module "*.svg?raw" {
  const text: string
  export default text
}

// eslint.rules.js is plain JavaScript; only the layer table is read by tests.
declare module "*/eslint.rules.js" {
  export const layers: ReadonlyArray<string>
  export const mayImport: Readonly<Record<string, ReadonlyArray<string>>>
}
