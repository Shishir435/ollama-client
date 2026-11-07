import { createAppError } from "@/lib/error-utils"

export type BrowserModelErrorCode =
  | "unavailable"
  | "not-ready"
  | "failed"
  | "unsupported"
  | "context-too-large"
  | "busy"
  | "timeout"
  | "disconnected"

/** Closed, content-free failures; DOMException messages may contain prompt data. */
export const browserModelError = (code: BrowserModelErrorCode) => {
  const key =
    code === "not-ready"
      ? "not_ready"
      : code === "context-too-large"
        ? "context_too_large"
        : code === "disconnected"
          ? "failed"
          : code
  const messages: Record<BrowserModelErrorCode, string> = {
    unavailable:
      "Browser built-in AI is unavailable on this browser or device.",
    "not-ready":
      "The browser model needs a download. Prepare it in provider settings.",
    failed: "Browser built-in AI could not complete the request. Please retry.",
    unsupported:
      "Browser built-in AI does not support this request or API format.",
    "context-too-large":
      "This conversation exceeds the browser model's context limit. Start a shorter chat.",
    busy: "The browser model is busy. Wait for another response to finish and retry.",
    timeout: "The browser model took too long to respond. Please retry.",
    disconnected: "The browser AI host disconnected. Please retry."
  }
  return createAppError(messages[code], {
    kind: "provider",
    providerId: "browser-built-in",
    messageKey: `settings.providers.browser_builtin.${key}`,
    userMessage: messages[code],
    retryable: ["failed", "busy", "timeout", "disconnected"].includes(code)
  })
}
