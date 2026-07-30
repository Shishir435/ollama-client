import { runtime } from "@/lib/browser-api"
import { getSafeClientEnvironment } from "@/lib/client-environment"
import { EXTERNAL_URLS } from "@/lib/constants"
import {
  sanitizeModelIdentifier,
  sanitizeProviderBaseUrl
} from "@/lib/error-utils"
import type { DiagnosticsGetBundleResult } from "@/protocol/diagnostics-rpc"
import type { ChatMessage } from "@/types"

export { getSafeClientEnvironment } from "@/lib/client-environment"

const getExtensionVersion = (): string => {
  try {
    return runtime.getManifest().version
  } catch {
    return "unknown"
  }
}

/**
 * Prefilled GitHub new-issue URL for a chat error. Every user-facing error
 * links here so a frustrated user's first click lands on the issue tracker
 * (with the diagnostic details already filled in) instead of a store review.
 */
type ErrorReportInput = {
  status?: number
  kind?: string
  message?: string
  providerId?: string
  providerName?: string
  model?: string
  baseUrl?: string
  code?: string
  phase?: string
  incidentId?: string
  durationMs?: number
  recoveryAction?: string
}

type DiagnosticBundle = DiagnosticsGetBundleResult["bundle"]

const supportBundleLines = [
  "",
  "**Optional support bundle (helps diagnose faster)**",
  "Open Ollama Client → Settings → Help → Diagnostics & support, select **Preview support bundle**, then **Download bundle**. Review the JSON file and drag it into this issue.",
  "The bundle can include up to seven days of privacy-safe technical events. Nothing is uploaded automatically."
]

/**
 * Empty fenced block the reporter pastes their copied diagnostics into. The
 * chat error panel and the diagnostics settings screen both expose a "Copy
 * diagnostics" action; without a paste target in the draft, that clipboard
 * payload has nowhere obvious to go and reporters drop it.
 */
const diagnosticsPasteLines = [
  "",
  "**Diagnostic logs**",
  "Optional but very helpful. Select **Copy diagnostics** on the failed message (or Settings → Help → Diagnostics & support), then paste between the fences below. Review it first — it is generated locally and never uploaded on its own.",
  "",
  "```json",
  "",
  "```"
]

/**
 * Fixed prose every draft ends with. Shared by all three builders so a report's
 * completeness never depends on which button the reporter happened to find:
 * paste target, bundle instructions, and the privacy statement are not optional
 * extras, they are what makes a draft safe to submit.
 */
const REPORT_TAIL = [
  ...diagnosticsPasteLines,
  ...supportBundleLines,
  "",
  "**Privacy**",
  "This draft was generated locally and opened for your review. It includes no telemetry, prompts, page content, file names, API keys, raw provider responses, or console logs.",
  "",
  "**Steps to reproduce**",
  "1. "
].join("\n")

export interface GenericIssueContext {
  providerId?: string
  model?: string
}

export const buildGenericIssueReportUrl = (
  context: GenericIssueContext = {}
): string => {
  const environment = getSafeClientEnvironment()
  const providerId =
    context.providerId && /^[a-zA-Z0-9_.:-]{1,100}$/.test(context.providerId)
      ? context.providerId
      : undefined
  const model = sanitizeModelIdentifier(context.model)?.replace(/[\r\n]+/g, " ")
  return composeReportUrl(
    "[bug] Help needed: ",
    [
      "**What happened?**",
      "",
      "",
      "**What did you expect?**",
      "",
      "",
      "**Environment**",
      `- Extension version: ${getExtensionVersion()}`,
      `- Browser: ${environment.browser} (best effort; edit if incorrect)`,
      `- OS: ${environment.os} (coarse family only)`,
      `- Selected provider: ${providerId ?? "n/a"}`,
      `- Selected model: ${model || "n/a"}`
    ].join("\n")
  )
}

/**
 * Chat-history migration evidence, when this profile has any. Omitted entirely
 * for a profile that never held a legacy blob, so a normal report does not carry
 * three lines about a migration that never happened.
 *
 * A clean result stays one line. Detail appears only when something went wrong,
 * because that is the only case a maintainer needs to read.
 */
const migrationLines = (
  migration: NonNullable<DiagnosticBundle>["storage"]["migration"]
): string[] => {
  if (!migration) return []
  const lines = [
    `- Chat migration: ${clampLine(migration.outcome, 40)} (attempt ${migration.attempts}, from schema v${migration.sourceSchemaVersion ?? "?"}, on ${clampLine(migration.extensionVersion, 20)})`
  ]
  if (migration.importedIntegrity && migration.importedIntegrity !== "ok") {
    lines.push(
      `- Migration integrity: ${clampLine(migration.importedIntegrity, 120)}`
    )
  }
  if (migration.foreignKeyViolations) {
    lines.push(`- Migration orphan rows: ${migration.foreignKeyViolations}`)
  }
  if (migration.mismatches?.length) {
    lines.push(
      `- Migration table mismatches: ${clampLine(migration.mismatches.join(", "), 200)}`
    )
  }
  if (migration.failure) {
    lines.push(`- Migration failure: ${clampLine(migration.failure, 200)}`)
  }
  return lines
}

/**
 * Draft opened from Settings → Help → Diagnostics & support, where the reporter
 * already has a bundle in hand. Shares the composer above, so this draft carries
 * the same paste block, privacy statement, and length guarantee as a chat-error
 * draft — it previously had none of the three.
 */
export const buildDiagnosticIssueUrl = (
  bundle: NonNullable<DiagnosticBundle>
): string => {
  const failed = bundle.selfTests
    .filter((test) => test.status === "fail")
    .map((test) => clampLine(`- ${test.id}: ${test.code ?? "failed"}`, 200))
    .slice(0, 20)
  return composeReportUrl(
    "[bug] Diagnostics support request",
    [
      "**What happened**",
      "_Describe the problem here._",
      "",
      "**Safe diagnostic summary**",
      `- Extension: ${clampLine(bundle.appVersion, 100)}`,
      `- Browser: ${clampLine(bundle.browserFamily, 100)}`,
      `- OS: ${clampLine(bundle.osFamily, 100)}`,
      `- Storage backend: ${clampLine(bundle.storage.backend, 100)}`,
      ...migrationLines(bundle.storage.migration),
      ...(failed.length > 0 ? failed : ["- Self-tests: passed"])
    ].join("\n")
  )
}

export interface SafeErrorChecks {
  providerEnabled?: boolean
  providerReachable?: boolean
  selectedModelFound?: boolean
  baseUrlValid?: boolean
  latencyMs?: number
}

const checkLines = (checks?: SafeErrorChecks): string[] => {
  if (!checks) return []
  const value = (result: boolean | undefined) =>
    result === undefined ? "not checked" : result ? "yes" : "no"
  // A duration measured on the failure path is useful (an instant refusal and a
  // 30 s timeout are different bugs) but reads as a contradiction next to
  // "reachable: no" unless it says what it timed.
  const latency =
    checks.latencyMs === undefined
      ? "n/a"
      : `${Math.round(checks.latencyMs)} ms${
          checks.providerReachable === false ? " (time to failure)" : ""
        }`
  return [
    "",
    "**Automatic checks (run locally after click)**",
    `- Provider enabled: ${value(checks.providerEnabled)}`,
    `- Provider reachable: ${value(checks.providerReachable)}`,
    `- Selected model discovered: ${value(checks.selectedModelFound)}`,
    `- Base URL valid: ${value(checks.baseUrlValid)}`,
    `- Provider discovery latency: ${latency}`
  ]
}

/**
 * GitHub answers 414 on very long request URLs, and a prefilled draft is a URL.
 * Stay under the ~8 KB practical ceiling with room to spare.
 *
 * Measured: a real provider-unreachable report is ~2.5 KB, and the worst case
 * the per-field clamps below allow (every field at its cap, 20 self-tests, 12
 * providers, 5 events) is ~4.9 KB. Encoding inflates the body only ~1.2x — the
 * cost is `%0A` per newline, since `URLSearchParams` writes spaces as `+`.
 * The trim tiers in `buildErrorReportUrl` are therefore unreachable today; they
 * exist so adding an unclamped field later degrades the draft instead of
 * shipping a URL GitHub rejects.
 */
const MAX_REPORT_URL_LENGTH = 7_500

/** One diagnostics line can otherwise grow with the number of providers/events. */
const clampLine = (value: string, max = 500): string =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value

const composeIssueUrl = (title: string, body: string): string =>
  `${EXTERNAL_URLS.GITHUB_ISSUES}/new?${new URLSearchParams({ title, body }).toString()}`

const diagnosticLines = (
  bundle: DiagnosticBundle | undefined,
  incidentId?: string
): string[] => {
  if (!bundle) return []
  const matchingEvents = bundle.events
    .filter((event) =>
      incidentId ? event.supportCode === incidentId : event.level === "error"
    )
    .slice(-5)
  return [
    "",
    "**Local diagnostics (run automatically after the error)**",
    clampLine(
      `- Self-tests: ${bundle.selfTests
        .slice(0, 20)
        .map(
          (test) =>
            `${test.id}=${test.status}${test.code ? ` (${test.code})` : ""}`
        )
        .join(", ")}`
    ),
    clampLine(
      `- Provider profiles: ${bundle.providers
        .slice(0, 12)
        .map(
          (provider) =>
            `${provider.profile}/${provider.wire}=${provider.enabled ? "enabled" : "disabled"}`
        )
        .join(", ")}`
    ),
    clampLine(
      `- Matching safe events: ${
        matchingEvents.length > 0
          ? matchingEvents
              .map(
                (event) =>
                  `${event.code}@${event.operation}${event.status ? `:${event.status}` : ""}`
              )
              .join(", ")
          : "none"
      }`
    )
  ]
}

const buildErrorReportDraft = (
  error: ErrorReportInput,
  diagnostics?: DiagnosticBundle,
  checks?: SafeErrorChecks
): { title: string; head: string } => {
  const message = (error.message ?? "").replace(/\s+/g, " ").trim()
  const providerName = error.providerName
    ?.replace(/\s+/g, " ")
    .trim()
    .slice(0, 100)
  const model = sanitizeModelIdentifier(error.model)?.replace(/[\r\n]+/g, " ")
  const baseUrl = sanitizeProviderBaseUrl(error.baseUrl)
  const safeToken = (value?: string) =>
    value && /^[A-Z0-9_-]{1,120}$/i.test(value) ? value : undefined
  const code = safeToken(error.code)
  const phase = safeToken(error.phase)
  const incidentId = safeToken(error.incidentId)
  const recoveryAction = safeToken(error.recoveryAction)
  const environment = getSafeClientEnvironment()
  const subject = providerName
    ? `${providerName} server error`
    : message.slice(0, 80) || "Error while chatting"
  const title = `[bug] ${code ? `${code}: ` : ""}${subject}${error.status ? ` (${error.status})` : ""}`
  // `head` is the variable-size part (it scales with the user's install and the
  // error text); `REPORT_TAIL` is fixed prose that must survive any trimming,
  // because it holds the diagnostics paste block and the privacy statement.
  const head = [
    "**What happened**",
    clampLine(message, 800) || "_describe the error here_",
    "",
    "**Details**",
    `- Extension version: ${getExtensionVersion()}`,
    `- Browser: ${environment.browser} (best effort; edit if incorrect)`,
    `- OS: ${environment.os} (coarse family only)`,
    `- Error status: ${error.status ?? "n/a"}`,
    `- Error kind: ${error.kind ?? "n/a"}`,
    `- Error code: ${code ?? "n/a"}`,
    `- Failure phase: ${phase ?? "n/a"}`,
    `- Incident ID: ${incidentId ?? "n/a"}`,
    `- Duration: ${error.durationMs === undefined ? "n/a" : `${Math.round(error.durationMs)} ms`}`,
    `- Suggested recovery: ${recoveryAction ?? "n/a"}`,
    `- Provider: ${providerName || error.providerId || "n/a"}`,
    `- Model: ${model || "n/a"}`,
    `- Base URL: ${clampLine(baseUrl || "n/a", 300)}`,
    ...checkLines(checks),
    ...diagnosticLines(diagnostics, incidentId)
  ].join("\n")
  return { title, head }
}

const TRIMMED_NOTICE =
  "\n\n_Some automatic detail was left out to fit the issue-URL length limit. Use **Copy diagnostics** and paste the full log below._"

/**
 * Shrink `head` until the composed URL fits, keeping `REPORT_TAIL` intact. The
 * 0.85 factor with a floor guarantees termination; the tail is fixed-size prose
 * well under the limit on its own.
 */
const fitHeadToUrl = (title: string, head: string): string => {
  let candidate = head
  while (
    candidate.length > 0 &&
    composeIssueUrl(title, `${candidate}${TRIMMED_NOTICE}\n${REPORT_TAIL}`)
      .length > MAX_REPORT_URL_LENGTH
  ) {
    candidate = candidate.slice(0, Math.floor(candidate.length * 0.85))
  }
  return `${candidate}${TRIMMED_NOTICE}\n${REPORT_TAIL}`
}

/** Attach the shared tail and guarantee the result is a URL GitHub accepts. */
const composeReportUrl = (title: string, head: string): string => {
  const url = composeIssueUrl(title, `${head}\n${REPORT_TAIL}`)
  return url.length <= MAX_REPORT_URL_LENGTH
    ? url
    : composeIssueUrl(title, fitHeadToUrl(title, head))
}

export const buildErrorReportUrl = (
  error: ErrorReportInput,
  diagnostics?: DiagnosticBundle,
  checks?: SafeErrorChecks
): string => {
  const full = buildErrorReportDraft(error, diagnostics, checks)
  const url = composeIssueUrl(full.title, `${full.head}\n${REPORT_TAIL}`)
  if (url.length <= MAX_REPORT_URL_LENGTH) return url

  // Tier 2: the embedded diagnostics summary is the section that scales with the
  // user's install, so it goes first. The paste block is a better home for a
  // long log anyway.
  const lean = buildErrorReportDraft(error, undefined, checks)
  const leanUrl = composeIssueUrl(
    lean.title,
    `${lean.head}${TRIMMED_NOTICE}\n${REPORT_TAIL}`
  )
  if (leanUrl.length <= MAX_REPORT_URL_LENGTH) return leanUrl

  // Tier 3: hard guarantee. Trim the details themselves rather than hand GitHub
  // a URL it answers 414 to.
  return composeIssueUrl(lean.title, fitHeadToUrl(lean.title, lean.head))
}

const chatMessageErrorInput = (message: ChatMessage): ErrorReportInput => ({
  status: message.error?.status,
  kind: message.error?.kind,
  message: message.error?.userMessage || message.content,
  providerId: message.error?.providerId,
  providerName: message.error?.providerName,
  model: message.error?.model || message.model,
  baseUrl: message.error?.baseUrl,
  code: message.error?.code,
  phase: message.error?.phase,
  incidentId: message.error?.incidentId,
  durationMs: message.error?.durationMs,
  recoveryAction: message.error?.recoveryAction
})

export const buildChatMessageErrorReportUrl = (
  message: ChatMessage,
  diagnostics?: DiagnosticBundle,
  checks?: SafeErrorChecks
): string =>
  buildErrorReportUrl(chatMessageErrorInput(message), diagnostics, checks)
