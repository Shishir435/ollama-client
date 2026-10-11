import { readFileSync } from "node:fs"
import { qualifyMatrix } from "./qualification-report.mjs"

/** Print a content-free comparison from saved reports; never starts or changes a provider. */
const paths = process.argv.slice(2)
if (paths.length < 2)
  throw new Error(
    "Pass qualification.json paths for at least two designated models"
  )
const reports = paths.map((path) => JSON.parse(readFileSync(path, "utf8")))
const summary = qualifyMatrix(reports)
console.log(JSON.stringify(summary, null, 2))
if (!summary.qualificationEvidenceComplete) process.exitCode = 1
