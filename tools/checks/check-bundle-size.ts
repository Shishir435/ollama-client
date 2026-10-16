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
  /*
   * Security updates to DOMPurify and markdown-it add 619 gzip bytes:
   * 236,119 -> 236,738 in both browsers. Preserve the prior 131-byte
   * headroom; all other content-script ceilings remain unchanged.
   */
  /**
   * The UX audit fixes — keyboard activation, focus return, copy feedback,
   * live regions, reduced motion and flip-above placement — measure 237,561
   * in both browsers. Shadow-DOM focus rings (the `@property` fallback) and
   * returning focus to the selection after close bring it to 238,177. The
   * shared contracts' approval values and run flags bring it to 238,421.
   */
  { metric: "selectionOverlay", field: "gzipBytes", max: 238_421 },
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
    // Security updates add 2,759 Chrome bytes, preserving existing headroom.
    /** The agent readiness line and its nine-locale copy measure Chrome at 48,589,345; read-only readiness and its evidence refresh, 48,590,811. */
    /** Structured terminal refusals add 87 bytes to Chrome's measured total. */
    /** UX audit fixes — classified failure copy, the origins command, rewritten and newly translated nine-locale strings — measure Chrome at 48,658,078. */
    /** Merged #468 and UX review fixes measure Chrome at 48,694,919 bytes. */
    /** 0.15.0-rc.1 hardening (Origin guard on both browsers, refusal copy, warmup load options) with this branch's other fixes measures Chrome at 48,701,078. */
    /** Review fixes (alternating-role history, image-only overrides, serialized reconciles, draft-rule release, guarded menu title) measure Chrome at 48,707,067. */
    /** Greptile review fixes (images through tool loops, polyfill-free origin-guard checks) measure Chrome at 48,707,304. */
    /** rc validation fixes (image errors, stream timings, rebuild hang, accessibility) measure Chrome at 48,712,006 and Firefox at 50,303,447. */
    /** Session speed over timed replies only adds 34 bytes: Chrome 48,712,040, Firefox 50,303,481. */
    /** Browser Prompt API adapter, host bridge, opt-in controls and localized copy measure Chrome at 48,726,546 and Firefox at 50,311,958. */
    /** Review fixes and consistent browser icons measure Chrome at 48,727,697 and Firefox at 50,313,391; content-script budgets remain unchanged. */
    /** Browse mode, plan consent, chat consent, approval values and the repeat classes measure Chrome at 48,754,338 and Firefox at 50,326,334. */
    /** Review fixes, the plan approval, the confirmed-repeat refusal and history stepping through the debugger measure Chrome at 48,765,560 and Firefox at 50,332,976. */
    /** Plan approval by listed outcome, stable row ids and finished-outcome sends measure Chrome at 48,766,029; Firefox is unchanged. */
    max: isFirefox ? 50_332_976 : 48_766_029
  },
  {
    metric: "zip",
    field: "bytes",
    max: isFirefox ? 24_500_000 : 23_600_000
  },
  {
    metric: "background",
    field: "gzipBytes",
    /** UX audit fixes — connection-failure classes, provider failure keys for cloud models, memory and runner crashes, the SearXNG and LM Studio cases — measure Chrome at 345,998 and Firefox at 224,229. */
    /** Merged #468 and UX review fixes measure Chrome at 351,845 gzip bytes and Firefox at 224,674. */
    /** 0.15.0-rc.1 hardening — Firefox's Origin listener, fail-closed DNR, refusal copy, history filter, warmup load options — measures Chrome at 353,180 and Firefox at 226,018. */
    /** Review fixes (alternating-role history, image-only overrides, serialized reconciles, draft-rule release, guarded menu title) measure Chrome at 353,788 and Firefox at 226,864. */
    /** Greptile review fixes (images through tool loops, polyfill-free origin-guard checks) measure Chrome at 353,866 and Firefox at 226,965. */
    /** rc validation fixes (image errors, stream timings, rebuild hang, accessibility) measure Chrome at 354,300 and Firefox at 227,378. */
    /** Browser Prompt API routing and lifecycle support measure Chrome at 356,340 and Firefox at 229,002 gzip bytes. */
    /** Shared browser glyph metadata measures Chrome at 356,391 and Firefox at 228,996 gzip bytes. */
    /** Browse mode, plan consent, chat consent, approval values and the repeat classes measure Chrome at 360,269 and Firefox at 229,597 gzip bytes. */
    /** Review fixes, the plan approval, the confirmed-repeat refusal and history stepping through the debugger measure Chrome at 361,551 and Firefox at 229,612 gzip bytes. */
    /** Plan approval by listed outcome, stable row ids and finished-outcome sends measure Chrome at 361,734 and Firefox at 229,621 gzip bytes. */
    max: isFirefox ? 229_621 : 361_734
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

/**
 * Symbols a shipped bundle must not contain, whatever the build did.
 *
 * `__agentReport` dumps a run's durable record — every step's command and the
 * page text its verifier quoted — and exists for a developer at a console. It
 * is gated on a compile-time constant, and the gate silently did nothing the
 * first time: it was read through a frozen object, which no bundler can fold,
 * so the store bundle carried the dump and the repository imports behind it.
 * A define is a claim about the output, so it is checked against the output.
 */
const FORBIDDEN_IN_STORE_BUILD = ["__agentReport"] as const

const storeBuildLeaks = (): string[] => {
  const sources = collectFiles(outputDir)
    .filter((file) => file.endsWith(".js"))
    .map((file) => fs.readFileSync(file, "utf8"))
  return FORBIDDEN_IN_STORE_BUILD.filter((symbol) =>
    sources.some((source) => source.includes(symbol))
  )
}

if (shouldCheck) {
  const leaked = storeBuildLeaks()
  for (const symbol of leaked) {
    console.error(
      `${symbol} is present in a store build; it must be compile-time absent`
    )
  }
  if (leaked.length > 0) process.exitCode = 1
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
