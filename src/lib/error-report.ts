import { runtime } from "@/lib/browser-api"
import { EXTERNAL_URLS } from "@/lib/constants"

/**
 * Prefilled GitHub new-issue URL for a chat error. Every user-facing error
 * links here so a frustrated user's first click lands on the issue tracker
 * (with the diagnostic details already filled in) instead of a store review.
 */
export const buildErrorReportUrl = (error: {
  status?: number
  kind?: string
  message?: string
}): string => {
  let version = "unknown"
  try {
    version = runtime.getManifest().version
  } catch {
    // Not running inside the extension (tests); leave "unknown".
  }
  const message = (error.message ?? "").replace(/\s+/g, " ").trim()
  const title = `[bug] ${message.slice(0, 80) || "Error while chatting"}`
  const body = [
    "**What happened**",
    message || "_describe the error here_",
    "",
    "**Details**",
    `- Extension version: ${version}`,
    `- Error status: ${error.status ?? "n/a"}`,
    `- Error kind: ${error.kind ?? "n/a"}`,
    `- Provider/model: `,
    "",
    "**Steps to reproduce**",
    "1. "
  ].join("\n")
  const params = new URLSearchParams({ title, body })
  return `${EXTERNAL_URLS.GITHUB_ISSUES}/new?${params.toString()}`
}
