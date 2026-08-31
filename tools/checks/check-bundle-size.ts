import { createHash } from "node:crypto"
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
  zip: Metric
  largestChunk: Metric
  duplicateAssets: Metric
  manifestContentScripts: Metric
  selectionBootstrap: Metric
  selectionOverlay: Metric
  background: Metric
  sidepanelInitial: Metric
  optionsInitial: Metric
}

const DEFAULT_OUTPUT_DIR = "build/chrome-mv3-prod"

const sharedBudgets: Budget[] = [
  {
    metric: "manifestContentScripts",
    field: "gzipBytes",
    max: 5_000
  },
  { metric: "selectionBootstrap", field: "gzipBytes", max: 5_000 },
  /*
   * Raised from 235,000, which left 54 bytes of headroom — less than one
   * `STORAGE_KEYS` entry costs. Every content script carries the whole
   * storage-key registry, descriptor prose included, because
   * `plasmoGlobalStorage` routes writes by scope; two new keys put it over.
   * Stripping those `reason` strings from production builds would buy back
   * several KB across every bundle and is the real fix when this bites again.
   */
  { metric: "selectionOverlay", field: "gzipBytes", max: 236_250 },
  { metric: "sidepanelInitial", field: "gzipBytes", max: 650_000 },
  { metric: "optionsInitial", field: "gzipBytes", max: 440_000 },
  { metric: "largestChunk", field: "gzipBytes", max: 225_000 },
  { metric: "duplicateAssets", field: "bytes", max: 0 }
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

const measureDuplicateAssets = (files: string[]): Metric => {
  const assetExtensions = new Set([
    ".avif",
    ".gif",
    ".jpeg",
    ".jpg",
    ".png",
    ".svg",
    ".wasm",
    ".webp",
    ".woff",
    ".woff2"
  ])
  const byHash = new Map<string, string[]>()

  for (const file of files) {
    if (!assetExtensions.has(path.extname(file).toLowerCase())) continue
    const content = fs.readFileSync(file)
    const hash = createHash("sha256").update(content).digest("hex")
    byHash.set(hash, [...(byHash.get(hash) ?? []), file])
  }

  return [...byHash.values()].reduce<Metric>(
    (total, duplicates) => {
      if (duplicates.length < 2) return total
      const redundant = duplicates.slice(1)
      const metric = measureFiles(redundant)
      total.bytes += metric.bytes
      total.gzipBytes += metric.gzipBytes
      return total
    },
    { bytes: 0, gzipBytes: 0 }
  )
}

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
const isFirefox = outputDir.includes("firefox")

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
const outputFiles = collectFiles(outputDir)
const packageZip = outputFiles.find(
  (file) => file.endsWith(".zip") && !file.endsWith("-sources.zip")
)
const chunkFiles = outputFiles.filter(
  (file) =>
    path.basename(path.dirname(file)) === "chunks" && file.endsWith(".js")
)
const largestChunk = chunkFiles
  .map((file) => ({ file, metric: measureFiles([file]) }))
  .sort((left, right) => right.metric.gzipBytes - left.metric.gzipBytes)[0]

const report: BundleReport = {
  total: measureFiles(outputFiles.filter((file) => !file.endsWith(".zip"))),
  zip: measureFiles(packageZip ? [packageZip] : []),
  largestChunk: largestChunk?.metric ?? { bytes: 0, gzipBytes: 0 },
  duplicateAssets: measureDuplicateAssets(
    outputFiles.filter((file) => !file.endsWith(".zip"))
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
const budgets: Budget[] = [
  ...sharedBudgets,
  {
    metric: "total",
    field: "bytes",
    max: isFirefox ? 11_800_000 : 9_500_000
  },
  {
    metric: "zip",
    field: "bytes",
    max: isFirefox ? 4_350_000 : 3_300_000
  },
  {
    metric: "background",
    field: "gzipBytes",
    // Generated-image responses plus embedding route validation, cancellation,
    // cache safeguards, retry metadata, native web-search routing, and the
    // complexity-helper split live
    // in the background owner. Keep Chrome narrow while leaving deterministic
    // build headroom.
    max: isFirefox ? 210_000 : 202_400
  }
]

console.log(
  JSON.stringify(
    {
      outputDir,
      target: isFirefox ? "firefox" : "chrome",
      largestChunk: largestChunk
        ? path.relative(outputDir, largestChunk.file)
        : null,
      report,
      budgets
    },
    null,
    2
  )
)

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
