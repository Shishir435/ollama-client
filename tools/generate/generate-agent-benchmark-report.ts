import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

interface Attempt {
  scenario: string
  terminalStatus: string
  expectedStatus: string
  succeeded?: boolean
  falseCompletion?: boolean
}

interface RunRecord {
  measuredAt: string
  model: string
  attempts: Attempt[]
}

const reportPath = resolve(
  "docs/src/content/docs/compare/browser-agent-benchmark-0.14.0.mdx"
)
const recordsDirectory = resolve("docs/src/data/browser-agent-benchmark-0.14.0")
const startMarker = "{/* benchmark-results:start */}"
const endMarker = "{/* benchmark-results:end */}"
const legacyStartMarker = "<!-- benchmark-results:start -->"
const legacyEndMarker = "<!-- benchmark-results:end -->"

const taskDescriptions: Record<string, string> = {
  "read-and-extract/visible-status":
    "Read and report the visible account status",
  "read-and-extract/below-the-fold":
    "Find and report the account number lower on the page",
  "read-and-extract/region-inspection":
    "Read and report the status inside the details region",
  "single-action/button-with-consequence":
    "Click Continue and report the status",
  "single-action/checkbox":
    "Tick the newsletter checkbox and report the status",
  "single-action/menu-then-option":
    "Open Actions, choose Approve, and report the status",
  "form-preparation/single-field": "Fill the given field without submitting",
  "form-preparation/three-fields-one-grant":
    "Fill all three fields without submitting",
  "form-preparation/select-and-check":
    "Choose South, accept the terms, and report the status",
  "editors/replace-then-save": "Correct “fax” to “fox” and save the report",
  "editors/append-then-save": "Add “Done.” to the report and save it",
  "editors/clear-and-retype":
    "Replace the report with “Rewritten.” and save it",
  "delayed-save/short-delay": "Save and wait for the saved indicator",
  "delayed-save/long-delay": "Save and wait for the delayed saved indicator",
  "delayed-save/claims-before-it-lands":
    "Do not claim success before the save finishes",
  "frames/same-origin-child": "Click Continue inside the embedded panel",
  "frames/child-with-form": "Fill the given field inside the embedded panel",
  "frames/srcdoc-cannot-be-read":
    "Pause and ask before acting in an unreadable embedded panel",
  "shadow-roots/button-in-open-root":
    "Click Continue inside an open shadow root",
  "shadow-roots/field-in-open-root":
    "Fill the field inside an open shadow root",
  "shadow-roots/slotted-text":
    "Read and report the status shown by slotted text",
  "canvas-and-visual/click-a-point":
    "Click the board’s left half and report the status",
  "canvas-and-visual/zoom-then-click":
    "Zoom in, then click the board’s left half",
  "canvas-and-visual/text-only-model":
    "Read the status beside the board without vision",
  "multi-tab/open-a-tab": "Open the details page and report its status",
  "multi-tab/follow-a-slow-link":
    "Follow the slow details link and report its status",
  "multi-tab/go-back": "Read details, return to Home, and report the heading",
  "dialogs-and-recovery/confirm-inside-a-modal":
    "Delete the item and confirm in the page modal",
  "dialogs-and-recovery/ask-then-act-on-the-answer":
    "Choose the second account after the user clarifies",
  "dialogs-and-recovery/native-confirm":
    "Delete the item and accept the browser confirmation",
  "report/write": "Read and report the status shown on the page"
}

const readRunRecord = async (path: string): Promise<RunRecord> => {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"))
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("attempts" in parsed) ||
    !Array.isArray(parsed.attempts) ||
    !("model" in parsed) ||
    typeof parsed.model !== "string" ||
    !("measuredAt" in parsed) ||
    typeof parsed.measuredAt !== "string"
  )
    throw new Error(`Invalid benchmark record: ${path}`)

  return parsed as RunRecord
}

const pagePasses = (attempts: Attempt[]) =>
  attempts.filter((attempt) => attempt.succeeded === true).length
const falseCompletions = (attempts: Attempt[]) =>
  attempts.filter((attempt) => attempt.falseCompletion === true).length
const metWithoutExpectedStatus = (attempts: Attempt[]) =>
  attempts.filter(
    (attempt) =>
      attempt.succeeded === true &&
      attempt.terminalStatus !== attempt.expectedStatus
  ).length

const resultLabel = (attempt?: Attempt): string => {
  if (!attempt) return "NR"
  if (attempt.succeeded === true)
    return attempt.terminalStatus === attempt.expectedStatus ? "PASS" : "PASS†"
  return attempt.falseCompletion === true ? "FAIL‡" : "FAIL"
}

const scoreTable = (
  ollamaClient: RunRecord,
  nanobrowser: RunRecord
): string => {
  const nanobrowserNames = new Set(
    nanobrowser.attempts.map((attempt) => attempt.scenario)
  )
  const sharedScenarios = ollamaClient.attempts
    .map((attempt) => attempt.scenario)
    .filter((scenario) => nanobrowserNames.has(scenario))
  const ollamaShared = ollamaClient.attempts.filter((attempt) =>
    nanobrowserNames.has(attempt.scenario)
  )
  const nanobrowserShared = nanobrowser.attempts.filter((attempt) =>
    sharedScenarios.includes(attempt.scenario)
  )
  const rows = [
    {
      label: "Ollama Client, shared scenarios",
      attempts: ollamaShared,
      total: sharedScenarios.length
    },
    {
      label: "Nanobrowser, shared scenarios",
      attempts: nanobrowserShared,
      total: sharedScenarios.length
    },
    {
      label: "Ollama Client, all scenarios",
      attempts: ollamaClient.attempts,
      total: ollamaClient.attempts.length
    },
    {
      label: "Nanobrowser, full suite",
      attempts: nanobrowser.attempts,
      total: ollamaClient.attempts.length
    }
  ]

  return [
    "| Comparison | Tasks with saved results | Page predicate passed | False completions | Goal met, but agent did not finish normally |",
    "|---|---:|---:|---:|---:|",
    ...rows.map(
      (row) =>
        `| ${row.label} | ${row.attempts.length}/${row.total} | ${pagePasses(row.attempts)} | ${falseCompletions(row.attempts)} | ${metWithoutExpectedStatus(row.attempts)} |`
    )
  ].join("\n")
}

const scenarioTable = (
  ollamaClient: RunRecord,
  nanobrowser: RunRecord
): string => {
  const nanobrowserByScenario = new Map(
    nanobrowser.attempts.map((attempt) => [attempt.scenario, attempt])
  )
  return [
    "| Scenario | What the page task asked for | Ollama Client | Nanobrowser |",
    "|---|---|---|---|",
    ...ollamaClient.attempts.map((attempt) => {
      if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(attempt.scenario))
        throw new Error(`Unsafe benchmark scenario label: ${attempt.scenario}`)
      const description = taskDescriptions[attempt.scenario] ?? attempt.scenario
      const nanobrowserAttempt = nanobrowserByScenario.get(attempt.scenario)
      return `| ${attempt.scenario} | ${description} | ${resultLabel(attempt)} | ${resultLabel(nanobrowserAttempt)} |`
    })
  ].join("\n")
}

const main = async (): Promise<void> => {
  const [ollamaClient, nanobrowser] = await Promise.all([
    readRunRecord(resolve(recordsDirectory, "ollama-client.json")),
    readRunRecord(resolve(recordsDirectory, "nanobrowser.json"))
  ])
  const report = await readFile(reportPath, "utf8")
  const inputMarkers = report.includes(startMarker)
    ? { start: startMarker, end: endMarker }
    : { start: legacyStartMarker, end: legacyEndMarker }
  const start = report.indexOf(inputMarkers.start)
  const end = report.indexOf(inputMarkers.end)
  if (start < 0 || end < start)
    throw new Error(
      "Benchmark report result markers are missing or out of order."
    )

  const generated = [
    startMarker,
    `Both runs used \`${ollamaClient.model}\`. Ollama Client was measured ${ollamaClient.measuredAt}; Nanobrowser was measured ${nanobrowser.measuredAt}.`,
    "",
    "### Score summary",
    "",
    scoreTable(ollamaClient, nanobrowser),
    "",
    "A task counts as passed only when the page itself shows the requested outcome. “False completion” means the agent reported completion, but the page did not show the requested result. “Goal met, but agent did not finish normally” means the page predicate passed while the recorded terminal status differed from the task’s expected status.",
    "",
    "### Scenario-by-scenario results",
    "",
    scenarioTable(ollamaClient, nanobrowser),
    "",
    "PASS means the page-state predicate passed. PASS† means it passed but the agent did not reach the expected terminal status. FAIL means the predicate failed without a false completion. FAIL‡ means the agent reported completion but the predicate failed. NR means no result was recorded for that task.",
    endMarker
  ].join("\n")
  const updated =
    report.slice(0, start) +
    generated +
    report.slice(end + inputMarkers.end.length)
  if (updated !== report) await writeFile(reportPath, updated)
  console.info(
    "Generated browser-agent benchmark tables from saved run records."
  )
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
