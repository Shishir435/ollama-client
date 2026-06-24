import { browser } from "@/lib/browser-api"
import { stripDataUrlPrefix } from "@/lib/image-utils"
import type {
  ToolContext,
  ToolDefinition,
  ToolResult,
  ToolResultImage
} from "../types"
import { accessDeniedMessage, classifyTabAccess } from "./tab-utils"

/**
 * `capture_screenshot` (0.11.17) — let a vision-capable model look at the user's
 * visible tab. The agent counterpart to the manual/auto screenshot attach
 * (0.11.5): there the user attaches a screenshot, here the model can decide to.
 *
 * Runs in the background service worker. `tabs.captureVisibleTab` returns a data
 * URL, which we split into the raw base64 the provider message shape wants. Only
 * offered to vision models — the definition's `requires: ["vision"]` makes
 * `resolveModelTools` drop it for text-only models.
 *
 * Privacy: honors the same exclude-list / restricted-scheme rules as the other
 * tab tools via `classifyTabAccess`, so a screenshot can't bypass a site the
 * user excluded from content extraction.
 */

/** Keep the lossless PNG at or under this size; re-capture as JPEG above it so a
 * HiDPI/4K frame stays reasonable. Mirrors the manual-capture heuristic. */
const PNG_KEEP_BYTES = 1_500_000
const SCREENSHOT_JPEG_QUALITY = 80

const base64Length = (dataUrl: string): number =>
  stripDataUrlPrefix(dataUrl).length

const captureVisibleTabImage = async (
  windowId: number
): Promise<ToolResultImage> => {
  const pngUrl = await browser.tabs.captureVisibleTab(windowId, {
    format: "png"
  })
  if (!pngUrl) throw new Error("capture returned no data")

  // base64 is ~4/3 of byte size; compare on the decoded byte estimate.
  if ((base64Length(pngUrl) * 3) / 4 <= PNG_KEEP_BYTES) {
    return { base64: stripDataUrlPrefix(pngUrl), mimeType: "image/png" }
  }

  const jpegUrl = await browser.tabs.captureVisibleTab(windowId, {
    format: "jpeg",
    quality: SCREENSHOT_JPEG_QUALITY
  })
  if (!jpegUrl) throw new Error("capture returned no data")
  return { base64: stripDataUrlPrefix(jpegUrl), mimeType: "image/jpeg" }
}

export const captureScreenshotDefinition: ToolDefinition = {
  name: "capture_screenshot",
  description:
    "Capture a screenshot of the user's currently visible browser tab and look at it. Use when the user asks what is on screen, refers to something visual on the page (a chart, image, diagram, layout), or when reading the page text is not enough. Returns the screenshot image for you to analyze.",
  displayNameKey: "chat.reasoning.trace.capture_screenshot",
  category: "browser",
  iconKey: "camera",
  risk: "medium",
  cacheable: false,
  requires: ["tabs", "vision"],
  runtime: { parallelizable: false, timeoutMs: 15_000 },
  parameters: {
    type: "object",
    properties: {}
  }
}

export const runCaptureScreenshot = async (
  _args: Record<string, unknown>,
  _ctx: ToolContext
): Promise<ToolResult> => {
  if (typeof browser.tabs?.captureVisibleTab !== "function") {
    return {
      content: "Screenshot capture is not supported in this browser.",
      isError: true
    }
  }

  try {
    const tab =
      (
        await browser.tabs.query({ active: true, lastFocusedWindow: true })
      )[0] ??
      (await browser.tabs.query({ active: true, currentWindow: true }))[0] ??
      (await browser.tabs.query({ active: true }))[0]

    if (!tab?.id || tab.windowId === undefined) {
      return {
        content: "No active tab is available to capture.",
        isError: true
      }
    }

    const access = await classifyTabAccess(tab.url)
    if (access !== "ok") {
      return {
        content: accessDeniedMessage(access, "the active tab"),
        isError: true
      }
    }

    const image = await captureVisibleTabImage(tab.windowId)
    const title = tab.title || "the active tab"
    return {
      content: `Captured a screenshot of "${title}". The image is attached for you to analyze.`,
      images: [image],
      sources: [{ title, url: tab.url }]
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      content: `Could not capture a screenshot (${message}). Browsers block capture on internal pages and extension galleries (chrome://, Chrome Web Store, etc.).`,
      isError: true
    }
  }
}
