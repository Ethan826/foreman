/// <reference types="vite/types/importMeta.d.ts" />

declare module "*.svg?raw" {
  const text: string
  export default text
}
