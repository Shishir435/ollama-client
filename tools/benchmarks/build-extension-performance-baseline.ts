import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import {
  buildPerformanceBaseline,
  extractPerformanceReports
} from "./extension-performance-baseline"

const args = process.argv.slice(2)
const outputFlag = args.indexOf("--output")
if (outputFlag < 0 || !args[outputFlag + 1]) {
  throw new Error(
    "Usage: pnpm benchmark:extension:performance:baseline -- --output <baseline.json> <artifact-directory-or-results.json...>"
  )
}
const outputPath = resolve(args[outputFlag + 1])
const inputs = args.filter(
  (argument, index) =>
    argument !== "--" && index !== outputFlag && index !== outputFlag + 1
)
if (inputs.length === 0) throw new Error("Provide downloaded CI artifact paths")

const jsonFiles = new Set<string>()
const visitPath = (path: string): void => {
  const absolute = resolve(path)
  try {
    const entries = readdirSync(absolute, { withFileTypes: true })
    for (const entry of entries) {
      const child = resolve(absolute, entry.name)
      if (entry.isDirectory()) visitPath(child)
      else if (entry.isFile() && entry.name.endsWith(".json"))
        jsonFiles.add(child)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOTDIR") {
      if (absolute.endsWith(".json")) jsonFiles.add(absolute)
      return
    }
    throw error
  }
}
for (const input of inputs) visitPath(input)

const reports = [...jsonFiles].flatMap((path) =>
  extractPerformanceReports(JSON.parse(readFileSync(path, "utf8")) as unknown)
)
const baseline = buildPerformanceBaseline(reports)
mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(baseline, null, 2)}\n`)
console.log(
  `Wrote ${outputPath} from ${baseline.sourceRunCount} CI runs (${jsonFiles.size} JSON artifacts).`
)
