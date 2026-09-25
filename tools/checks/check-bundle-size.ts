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
    /**
     * Chrome's uncompressed total crossed 9.5MB with the Agent completion
     * gate and its bounded waiting; the measured figure is 9,502,623. Raised
     * to the next step rather than rounded generously, so the next thing to
     * cross it is measured too.
     *
     * Batched form filling, multi-query lookups and the resolved context
     * window took it to 9,626,409. Most of that is prose rather than code:
     * the tool schema the model reads, the refusal vocabulary a batch needs
     * in order to say which of twelve fields was wrong, and the settings copy
     * in nine locales.
     *
     * Conversation handoffs took it to 9,704,341. The handoff's wire schema
     * rides on every chat message, so every surface that parses messages
     * carries it, along with the fence a later turn reads it inside.
     *
     * The PR1 Agent audit fixes took the measured Chrome build to 9,757,051:
     * form evidence, dialog recovery and localized approval text ship on the
     * run path. The three regression pages and spec are test-only.
     *
     * The run timeline took it to 9,761,411: row, duration and reasoning
     * display, the settled card's record, steering, and their copy in nine
     * locales.
     *
     * The hosted-model benchmark's fixes took it to 9,770,393: the search
     * textarea and short-page fallbacks, completion evidence from receipts,
     * the user-tab rule, the start address, the finish-reviewed control and
     * its copy in nine locales. Their review fixes, 9,773,473: the routine
     * consent sentence in nine locales and the visible-field submission.
     * The second review round, 9,774,474: counted query pairs and the
     * named-field binding for batch evidence.
     */
    max: isFirefox ? 11_800_000 : 9_775_000
  },
  {
    metric: "zip",
    field: "bytes",
    max: isFirefox ? 4_350_000 : 3_300_000
  },
  {
    metric: "background",
    field: "gzipBytes",
    /**
     * Generated-image responses plus embedding route validation,
     * cancellation, cache safeguards, retry metadata, native web-search
     * routing, Agent recovery/composition, and the complexity-helper split
     * live in the background owner.
     *
     * The Chrome service worker is a classic worker, so WXT inlines every
     * dynamic import into background.js: the Agent run loop, its effect layer
     * and its provider decision port cannot be split out of the startup
     * bundle, and wiring them raised the measured Chrome baseline from
     * 205,819 to 223,794. Firefox carries no Agent code and stays at its
     * measured 204,177.
     *
     * The shared affordance classifier, the vocabularies that keep page text
     * out of its feedback, and the resolution-failure mapping raised the
     * measured Chrome baseline to 227,848: every refusal the model can be
     * corrected on is a sentence that ships. Firefox is unchanged.
     *
     * Durable step history — the receipt fields that survive a snapshot, the
     * bounded record built from them, and the prompt that carries it — took
     * the measured Chrome baseline to 228,969.
     *
     * The model-visible projection, the modal and grouping reporting, and the
     * document-text collection took the measured Chrome baseline to 229,855.
     *
     * Run-scoped grants and the durable question channel — contracts, the
     * policy grant path, the two panel cards — took it to 230,700.
     *
     * The Chromium debugger session manager — attach ownership, the tab and
     * detach listeners, the ownership gate on page-work claims — took it to
     * 232,235. Firefox is unchanged.
     *
     * Frame-aware identity — per-frame control sessions composed into one
     * observation, frame authorization, the debugger frame tree and its
     * explicit mapping, and per-run tab scope — took it to 235,751.
     *
     * Context budgeting and progressive inspection — the bounded overview and
     * its budget partition, the three read-only inspection commands, and the
     * durable findings store — took it to 237,205. Firefox carries no Agent
     * code and is unchanged.
     *
     * Native input — the plan builder and its key table, the cancellation-safe
     * runner, the delivery matcher, the debugger input channel with its frame
     * placement, and the two new control-port messages — took it to 243,113.
     * Firefox carries no Agent code and is unchanged.
     *
     * Screenshots and visual grounding — the capture pipeline with its masking
     * and geometry, the OffscreenCanvas editor, the debugger capture, hit-test
     * and rect messages, and the vision variant of the decision tool — took it
     * to 248,454. Firefox carries no Agent code and is unchanged.
     *
     * Editors and drag interactions — the editing-host reader and its
     * selection/insertion helpers, the shared text normalization, the
     * synthetic and debugger-driven drag with its HTML5 interception, the
     * arrangement verifier, and the file-chooser hold-back — took it to
     * 251,314. Firefox carries no Agent code and is unchanged.
     *
     * Dialogs and action-specific approvals — the held-dialog record and its
     * answering path in the session manager, the blocked-page observation,
     * the dialog action family with its own resolver, executor and verifier,
     * and the dialog rules in the classifier and the policy — took it to
     * 253,519. Firefox carries no Agent code and is unchanged.
     *
     * Task outcomes and recovery — the completion judge and its shared
     * observed-text matcher, the durable `mutating` receipt field, and the
     * bounded wait poll — took it to 255,224. Firefox carries no Agent code
     * and is unchanged.
     *
     * The unmatched-request report — the region miss and the region names
     * that answer it, plus the prompt line that tells the model what they
     * mean — took it to 256,035. Firefox carries no Agent code and is
     * unchanged.
     *
     * Task recovery, paginated reads, pane scrolling and dialog handling took
     * it to 259,597.
     *
     * Live-run reliability — the closed refusal vocabulary carried across the
     * control port, the authorship record the egress rule reads, the settle
     * window around an ambiguous verification, and the supervisor's path out
     * of an unresolved effect — took it to 262,135. Every one of those is a
     * sentence or a durable field that has to ship: a refusal the run cannot
     * name is a failure nobody can diagnose. Firefox gains only the provider
     * busy failure and stays well under its own ceiling.
     *
     * Step telemetry — the durable numbers schema, the per-phase accumulator
     * in the controller, and the provider usage the decision collector now
     * keeps instead of discarding — took it to 263,390. It is the smallest
     * raise in this list and the one the rest of the release depends on:
     * every remaining gate is stated as a comparison against a baseline, and
     * a baseline cannot be read from a run that measured nothing. Firefox
     * carries no Agent code and is unchanged.
     *
     * Task requirements — the planning call and its tool, the per-requirement
     * completion judge, and the panel list a settled run shows — took it to
     * 265,089. Most of it is the planning prompt and the outcome vocabulary,
     * both of which are text that has to reach the model or the reader. It
     * buys the release's largest correctness gate: before this, a run told to
     * fill a form and submit it could submit an empty one and report success,
     * because submitting is a mutation and the verifier confirmed it. Firefox
     * carries no Agent code and is unchanged.
     *
     * Scoped reads — the document walk behind `find` and `inspect`, the scope
     * carried down the control port, and the prompt lines that tell the model
     * how to continue one and how to reach what it found — took it to 266,005.
     * Five bytes over, and worth the raise rather than the trim: before this a
     * control past the 2,000-element capture cap was unreachable by any query
     * and any context window, because nothing went back to the page. Firefox
     * carries no Agent code and is unchanged.
     *
     * Batched filling, multi-query lookups and the resolved context window —
     * the fifth action family with its own resolve, execute and verify, the
     * batch's wire schema, the one-walk lookup, and the window resolution
     * that replaced two literals — took it to 269,969. The largest single
     * part of it is text the model reads: the batch's own tool schema and the
     * per-field refusals, without which a twelve-field batch can be refused
     * but not corrected. Firefox carries no Agent code and is unchanged.
     *
     * Requirement-scoped completion evidence, the atomic takeover resume, the
     * reviewed-effect disposition, and the Agent reasoning-effort wiring — one
     * verified state per requirement instead of one quotation rule for
     * state-only controls, a Done-before-Started that converges on a single
     * resume, a recorded review that lifts the unverified refusal without
     * vouching for the effect, and the slider's answer on planning and
     * decision requests — took it to 272,557. Firefox carries no Agent code
     * and is unchanged.
     *
     * Boundary-aware, negation-safe requirement/result binding took the
     * measured Chrome baseline to 273,173. Firefox carries no Agent code and
     * is unchanged.
     *
     * Model readiness — the wire schema the panel is told the verdict in, the
     * total mapping from the compatibility union onto it, and the catalog
     * scan that names models which could run instead, plus the invalidation
     * that keeps a cached verdict from outliving its evidence — took it to
     * 274,474.
     * The alternative to shipping it is the behaviour it replaces: Start
     * stayed live for a model that cannot call tools, and the refusal arrived
     * after the run had attached to a tab. Firefox carries no Agent code and
     * is unchanged.
     *
     * Tying a run to the conversation it belongs to — the linkage migration
     * and its repository ops, the commit that writes the request, the card and
     * the run together, and the cleanup a deleted chat asks for — took the
     * measured Chrome baseline to 276,291. Most of it is SQL: statements that
     * have to name every column they write, the batching that keeps a large
     * deletion inside the persistence bind ceiling, and the startup sweep that
     * settles a run whose chat is gone. Firefox carries no Agent code and is
     * unchanged.
     *
     * 277,000 rather than the usual next step above the measurement: 276,500
     * left 209 bytes, which is less than one statement, and the 235,000
     * ceiling above is here because 54 bytes of headroom stopped a release.
     *
     * Drawing a run's card in its chat — the read-only projection a card asks
     * for, its wire schema in the registry the server validates against, and
     * the handler that reaches it — took it to 277,280. The alternative is a
     * card with no reader: the row it is drawn into is empty until the run
     * settles, so without the projection a live run shows nothing at all.
     * Firefox carries no Agent code and is unchanged.
     *
     * Conversation handoffs — the projection written in the settling commit,
     * the sanitiser that strips links and secrets from what it carries, and
     * the read that gives a follow-up the handoff the page never loaded — took
     * it to 278,451. The alternative is a follow-up that knows nothing of the
     * run above it, or one that reads the run's page-derived answer unfenced.
     *
     * Follow-up runs — reading the parent's record and committed effects from
     * its own rows, the rule that refuses a repeat before policy, and the
     * record in the decision and planning prompts — took it to 280,450. The
     * alternative is a retry that knows nothing of the order the last run
     * already placed.
     *
     * The toolbar mark for a run waiting on the user — the only signal a
     * parked approval has once the Agent surface is gone and the panel is
     * closed — took it to 281,140. The alternative is a run that pauses
     * where nobody can see it.
     *
     * PR1 form completion evidence, native-dialog dismissal recording and
     * row-specific approval context took the measured Chrome worker to
     * 283,287. Firefox carries no Agent code and is unchanged.
     *
     * Starting runs from chat took it to 287,191: the `browser_task` runner,
     * turn-row linkage and the wait on a delegated run now live in the
     * worker, and the start prompt's confirmation hook rides on the tool
     * loop every chat turn uses.
     *
     * Firefox compiles `browser_task` out, but the tool loop's confirmation
     * hook, the turn fields it reads and the permission-mode setting are
     * chat infrastructure both browsers share: 210,289.
     *
     * The run timeline took Chrome to 290,481: the page indicator drawn
     * through the debugger overlay, page-opened tab adoption and grouping,
     * steering, and the card record's step projection. Firefox moved to
     * 212,329 on what chat shares: the browser-context preamble every turn
     * with tab tools builds, and the panel tab `current_tab` now reads.
     *
     * The hosted-model benchmark's fixes took Chrome to 292,367: the live
     * command record the completion judge reads, the user-tab rule, routine
     * consent following an approved site, the start address and the
     * finish-reviewed path. Their review fixes, 292,591: the approval's
     * routine origin and the tighter evidence bindings. The second round,
     * 292,960: the named-field binding and the whole-notice routine rule.
     */
    max: isFirefox ? 212_600 : 293_100
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
