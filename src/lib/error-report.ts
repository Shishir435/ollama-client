import { runtime } from "@/lib/browser-api"
import { EXTERNAL_URLS } from "@/lib/constants"
import {
  sanitizeModelIdentifier,
  sanitizeProviderBaseUrl
} from "@/lib/error-utils"
import type { DiagnosticsGetBundleResult } from "@/protocol/diagnostics-rpc"
import type { ChatMessage } from "@/types"

type NavigatorWithBrands = Navigator & {
  brave?: unknown
  userAgentData?: {
    brands?: Array<{ brand: string; version: string }>
    platform?: string
  }
}

const majorVersion = (userAgent: string, pattern: RegExp): string | undefined =>
  userAgent.match(pattern)?.[1]

const getExtensionVersion = (): string => {
  try {
    return runtime.getManifest().version
  } catch {
    return "unknown"
  }
}

export const getSafeClientEnvironment = (): {
  browser: string
  os: string
} => {
  if (typeof navigator === "undefined") {
    return { browser: "unknown", os: "unknown" }
  }

  const nav = navigator as NavigatorWithBrands
  const userAgent = nav.userAgent || ""
  const brands = nav.userAgentData?.brands ?? []
  const chromiumVersion =
    brands.find(({ brand }) => /Chromium/i.test(brand))?.version ||
    majorVersion(userAgent, /(?:Chrome|CriOS)\/(\d+)/i)
  const isBrave =
    Boolean(nav.brave) || brands.some(({ brand }) => /Brave/i.test(brand))

  const browser = /Firefox\/(\d+)/i.test(userAgent)
    ? `Firefox ${majorVersion(userAgent, /Firefox\/(\d+)/i)}`
    : /Edg(?:e|A|iOS)?\/(\d+)/i.test(userAgent)
      ? `Edge ${majorVersion(userAgent, /Edg(?:e|A|iOS)?\/(\d+)/i)}`
      : /OPR\/(\d+)/i.test(userAgent)
        ? `Opera ${majorVersion(userAgent, /OPR\/(\d+)/i)}`
        : isBrave
          ? `Brave${chromiumVersion ? ` (Chromium ${chromiumVersion})` : ""}`
          : /(?:Chrome|CriOS)\/(\d+)/i.test(userAgent)
            ? `Chrome/Chromium ${majorVersion(userAgent, /(?:Chrome|CriOS)\/(\d+)/i)}`
            : /Version\/(\d+).+Safari\//i.test(userAgent)
              ? `Safari ${majorVersion(userAgent, /Version\/(\d+)/i)}`
              : "unknown"

  const platform = nav.userAgentData?.platform || nav.platform || ""
  const osSource = `${userAgent} ${platform}`
  const os = /Android/i.test(osSource)
    ? "Android"
    : /iPhone|iPad|iPod/i.test(osSource)
      ? "iOS/iPadOS"
      : /Windows/i.test(osSource)
        ? "Windows"
        : /CrOS/i.test(osSource)
          ? "ChromeOS"
          : /Mac OS|Macintosh|MacIntel/i.test(osSource)
            ? "macOS"
            : /Linux/i.test(osSource)
              ? "Linux"
              : "unknown"

  return { browser, os }
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
  const body = [
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
    `- Selected model: ${model || "n/a"}`,
    "",
    "**Privacy**",
    "This draft was generated locally and opened for your review. It includes no telemetry, prompts, page content, file names, API keys, provider responses, or console logs.",
    "",
    "**Steps to reproduce**",
    "1. "
  ].join("\n")
  const params = new URLSearchParams({
    title: "[bug] Help needed: ",
    body
  })
  return `${EXTERNAL_URLS.GITHUB_ISSUES}/new?${params.toString()}`
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
  return [
    "",
    "**Automatic checks (run locally after click)**",
    `- Provider enabled: ${value(checks.providerEnabled)}`,
    `- Provider reachable: ${value(checks.providerReachable)}`,
    `- Selected model discovered: ${value(checks.selectedModelFound)}`,
    `- Base URL valid: ${value(checks.baseUrlValid)}`,
    `- Provider discovery latency: ${
      checks.latencyMs === undefined
        ? "n/a"
        : `${Math.round(checks.latencyMs)} ms`
    }`
  ]
}

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
    "**Local diagnostics (run when Open an issue was clicked)**",
    `- Self-tests: ${bundle.selfTests
      .slice(0, 20)
      .map(
        (test) =>
          `${test.id}=${test.status}${test.code ? ` (${test.code})` : ""}`
      )
      .join(", ")}`,
    `- Provider profiles: ${bundle.providers
      .slice(0, 12)
      .map(
        (provider) =>
          `${provider.profile}/${provider.wire}=${provider.enabled ? "enabled" : "disabled"}`
      )
      .join(", ")}`,
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
  ]
}

export const buildErrorReportUrl = (
  error: ErrorReportInput,
  diagnostics?: DiagnosticBundle,
  checks?: SafeErrorChecks
): string => {
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
  const body = [
    "**What happened**",
    message || "_describe the error here_",
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
    `- Base URL: ${baseUrl || "n/a"}`,
    ...checkLines(checks),
    ...diagnosticLines(diagnostics, incidentId),
    "",
    "**Privacy**",
    "This draft was generated locally and opened for your review. It includes no telemetry, prompts, page content, file names, API keys, raw provider responses, or console logs.",
    "",
    "**Steps to reproduce**",
    "1. "
  ].join("\n")
  const params = new URLSearchParams({ title, body })
  return `${EXTERNAL_URLS.GITHUB_ISSUES}/new?${params.toString()}`
}

export const buildChatMessageErrorReportUrl = (
  message: ChatMessage,
  diagnostics?: DiagnosticBundle,
  checks?: SafeErrorChecks
): string =>
  buildErrorReportUrl(
    {
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
    },
    diagnostics,
    checks
  )
