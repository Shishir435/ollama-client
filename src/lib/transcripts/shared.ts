import { logger } from "@/lib/logger"

export const sleep = (delayMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, delayMs))

/** Waits for an element to appear in the DOM with retries. */
export const waitForElement = async (
  selector: string,
  maxAttempts = 10,
  delayMs = 500
): Promise<HTMLElement | null> => {
  for (let i = 0; i < maxAttempts; i++) {
    const element = document.querySelector<HTMLElement>(selector)
    if (element) {
      logger.debug(
        `Found element with selector "${selector}" after ${i + 1} attempts`,
        "TranscriptExtractor"
      )
      return element
    }
    await sleep(delayMs)
  }
  logger.debug(
    `Element "${selector}" not found after ${maxAttempts} attempts`,
    "TranscriptExtractor"
  )
  return null
}

export const normalizeTranscriptLine = (text: string): string =>
  text.replace(/\s+/g, " ").trim()

export const formatTranscriptTimestamp = (milliseconds: number): string => {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

export const normalizeTranscriptTimestamp = (text?: string | null): string => {
  const normalized = normalizeTranscriptLine(text || "")
  const match = normalized.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/)
  return match?.[0] ?? ""
}

export const withTranscriptTimestamp = (
  timestamp: string,
  text: string
): string => {
  const normalizedText = normalizeTranscriptLine(text)
  if (!normalizedText) return ""
  if (!timestamp || normalizedText.startsWith(timestamp)) return normalizedText
  return `${timestamp} ${normalizedText}`
}
