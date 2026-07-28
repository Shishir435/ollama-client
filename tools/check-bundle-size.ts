import fs from "node:fs"
import path from "node:path"
import { gzipSync } from "node:zlib"

type Metric = {
  bytes: number
  gzipBytes: number
}

type Budget = {
  metric: keyof BundleReport
  field: keyof Metric
  max: number
}

type BundleReport = {
  total: Metric
  manifestContentScripts: Metric
  selectionBootstrap: Metric
  selectionOverlay: Metric
  background: Metric
  sidepanelInitial: Metric
  optionsInitial: Metric
}

const DEFAULT_OUTPUT_DIR = "build/chrome-mv3-prod"

const budgets: Budget[] = [
  { metric: "total", field: "bytes", max: 9_500_000 },
  {
    metric: "manifestContentScripts",
    field: "gzipBytes",
    max: 5_000
  },
  { metric: "selectionBootstrap", field: "gzipBytes", max: 5_000 },
  { metric: "selectionOverlay", field: "gzipBytes", max: 235_000 },
  { metric: "background", field: "gzipBytes", max: 190_000 },
  { metric: "sidepanelInitial", field: "gzipBytes", max: 650_000 },
  { metric: "optionsInitial", field: "gzipBytes", max: 440_000 }
]

const collectFiles = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    return entry.isDirectory() ? collectFiles(target) : [target]
  })

const measureFiles = (files: string[]): Metric =>
  files.reduce<Metric>(
    (total, file) => {
      if (!fs.existsSync(file)) return total
      const content = fs.readFileSync(file)
      total.bytes += content.byteLength
      total.gzipBytes += gzipSync(content).byteLength
      return total
    },
    { bytes: 0, gzipBytes: 0 }
  )

const resolveOutputFiles = (outputDir: string, files: string[]): string[] =>
  [...new Set(files)].map((file) =>
    path.join(outputDir, file.replace(/^\/+/, ""))
  )

const htmlInitialFiles = (outputDir: string, htmlName: string): string[] => {
  const htmlPath = path.join(outputDir, htmlName)
  const html = fs.readFileSync(htmlPath, "utf8")
  const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(
    (match) => match[1]
  )
  return [htmlPath, ...resolveOutputFiles(outputDir, assets)]
}

const outputArg = process.argv.find(
  (argument, index) => index > 1 && !argument.startsWith("--")
)
const outputDir = path.resolve(outputArg ?? DEFAULT_OUTPUT_DIR)
const shouldCheck = process.argv.includes("--check")

if (!fs.existsSync(outputDir)) {
  throw new Error(`Bundle output not found: ${outputDir}`)
}

const manifest = JSON.parse(
  fs.readFileSync(path.join(outputDir, "manifest.json"), "utf8")
) as {
  content_scripts?: Array<{ js?: string[]; css?: string[] }>
}
const manifestFiles =
  manifest.content_scripts?.flatMap((entry) => [
    ...(entry.js ?? []),
    ...(entry.css ?? [])
  ]) ?? []

const report: BundleReport = {
  total: measureFiles(
    collectFiles(outputDir).filter((file) => !file.endsWith(".zip"))
  ),
  manifestContentScripts: measureFiles(
    resolveOutputFiles(outputDir, manifestFiles)
  ),
  selectionBootstrap: measureFiles([
    path.join(outputDir, "content-scripts/selection-button.js")
  ]),
  selectionOverlay: measureFiles([
    path.join(outputDir, "content-scripts/selection-overlay.js")
  ]),
  background: measureFiles([path.join(outputDir, "background.js")]),
  sidepanelInitial: measureFiles(htmlInitialFiles(outputDir, "sidepanel.html")),
  optionsInitial: measureFiles(htmlInitialFiles(outputDir, "options.html"))
}

console.log(JSON.stringify({ outputDir, report, budgets }, null, 2))

if (shouldCheck) {
  const failures = budgets.filter(
    (budget) => report[budget.metric][budget.field] > budget.max
  )
  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(
        `${failure.metric}.${failure.field}: ${report[failure.metric][failure.field]} > ${failure.max}`
      )
    }
    process.exitCode = 1
  }
}
