import { runtime } from "@/lib/browser-api"
import { EXTERNAL_URLS } from "@/lib/constants"
import { sanitizeProviderBaseUrl } from "@/lib/error-utils"

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
  const browser =
    typeof navigator === "undefined"
      ? "unknown"
      : /Firefox\//.test(navigator.userAgent)
        ? "Firefox"
        : /Edg\//.test(navigator.userAgent)
          ? "Edge"
          : /Chrome\//.test(navigator.userAgent)
            ? "Chrome"
            : "unknown"
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
    `- Browser: ${browser}`,
    `- Error status: ${error.status ?? "n/a"}`,
    `- Error kind: ${error.kind ?? "n/a"}`,
    `- Provider: ${providerName || error.providerId || "n/a"}`,
    `- Model: ${model || "n/a"}`,
    `- Base URL: ${baseUrl || "n/a"}`,
    "",
    "**Steps to reproduce**",
    "1. "
  ].join("\n")
  const params = new URLSearchParams({ title, body })
  return `${EXTERNAL_URLS.GITHUB_ISSUES}/new?${params.toString()}`
}
