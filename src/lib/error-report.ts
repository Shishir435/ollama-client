import { runtime } from "@/lib/browser-api"
import { EXTERNAL_URLS } from "@/lib/constants"
import { sanitizeProviderBaseUrl } from "@/lib/error-utils"
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
            ? `Chrome ${majorVersion(userAgent, /(?:Chrome|CriOS)\/(\d+)/i)}`
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
export const buildErrorReportUrl = (error: {
  status?: number
  kind?: string
  message?: string
  providerId?: string
  providerName?: string
  model?: string
  baseUrl?: string
}): string => {
  let version = "unknown"
  try {
    version = runtime.getManifest().version
  } catch {
    // Not running inside the extension (tests); leave "unknown".
  }
  const message = (error.message ?? "").replace(/\s+/g, " ").trim()
  const providerName = error.providerName?.trim()
  const model = error.model?.trim()
  const baseUrl = sanitizeProviderBaseUrl(error.baseUrl)
  const environment = getSafeClientEnvironment()
  const subject = providerName
    ? `${providerName} server error`
    : message.slice(0, 80) || "Error while chatting"
  const title = `[bug] ${subject}${error.status ? ` (${error.status})` : ""}`
  const body = [
    "**What happened**",
    message || "_describe the error here_",
    "",
    "**Checks tried**",
    "- Provider app is running: ",
    "- Selected model is loaded: ",
    "- Base URL/port is correct: ",
    "",
    "**Details**",
    `- Extension version: ${version}`,
    `- Browser: ${environment.browser} (best effort; edit if incorrect)`,
    `- OS: ${environment.os} (coarse family only)`,
    `- Error status: ${error.status ?? "n/a"}`,
    `- Error kind: ${error.kind ?? "n/a"}`,
    `- Provider: ${providerName || error.providerId || "n/a"}`,
    `- Model: ${model || "n/a"}`,
    `- Base URL: ${baseUrl || "n/a"}`,
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

export const buildChatMessageErrorReportUrl = (message: ChatMessage): string =>
  buildErrorReportUrl({
    status: message.error?.status,
    kind: message.error?.kind,
    message: message.error?.userMessage || message.content,
    providerId: message.error?.providerId,
    providerName: message.error?.providerName,
    model: message.error?.model || message.model,
    baseUrl: message.error?.baseUrl
  })
