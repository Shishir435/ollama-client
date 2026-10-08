import { readFileSync } from "node:fs"
import { evaluateRelease } from "./release-gate.mjs"

const [candidate, ...paths] = process.argv.slice(2)
if (paths.length < 2)
  throw new Error(
    "Pass the exact release SHA and qualification.json paths for two models"
  )
const result = evaluateRelease(
  paths.map((path) => JSON.parse(readFileSync(path, "utf8"))),
  candidate
)
console.log(JSON.stringify(result, null, 2))
if (!result.promotionReady) process.exitCode = 1
