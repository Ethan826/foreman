import { fileURLToPath } from "node:url"
import { buildConfig } from "../eslint.rules.js"

export default buildConfig({
  tsconfigRootDir: fileURLToPath(new URL(".", import.meta.url)),
})
