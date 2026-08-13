import { logger } from "@/lib/logger"
import {
  normalizeTranscriptLine,
  sleep,
  waitForElement
} from "@/lib/transcripts/shared"

const TRANSCRIPT_PANEL_SELECTOR = '[data-purpose="transcript-panel"]'
const TRANSCRIPT_CUE_SELECTOR = '[data-purpose="cue-text"]'
const TRANSCRIPT_TOGGLE_SELECTOR =
  'button[data-purpose="transcript-toggle"], [data-purpose="transcript-toggle"], svg[aria-label*="transcript" i]'

const isUdemyLecturePage = (): boolean =>
  window.location.href.includes("udemy.com/course/") &&
  window.location.href.includes("/learn/lecture/")

const extractPanelTranscript = (): string | null => {
  const transcriptPanel = document.querySelector(TRANSCRIPT_PANEL_SELECTOR)
  if (!transcriptPanel) return null

  const cues = transcriptPanel.querySelectorAll(TRANSCRIPT_CUE_SELECTOR)
  logger.info(
    `Found ${cues.length} Udemy transcript cues`,
    "TranscriptExtractor"
  )
  if (cues.length === 0) return null

  const transcript = Array.from(cues)
    .map((cue) => normalizeTranscriptLine(cue.textContent || ""))
    .filter(Boolean)
    .join("\n")

  return transcript.length > 0 ? transcript : null
}

const findTranscriptButton = (): HTMLElement | null => {
  const clickableSelector = 'button, [role="button"], [role="tab"]'
  const toClickable = (element: HTMLElement): HTMLElement =>
    element.closest<HTMLElement>(clickableSelector) || element
  const isVisible = (element: HTMLElement): boolean => {
    const style = window.getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.pointerEvents !== "none" &&
      rect.width > 0 &&
      rect.height > 0
    )
  }
  const candidates = Array.from(
    new Set(
      Array.from(
        document.querySelectorAll<HTMLElement>(
          [
            TRANSCRIPT_TOGGLE_SELECTOR,
            'button[aria-label*="transcript" i]',
            'button[data-purpose*="transcript" i]',
            '[role="tab"][aria-label*="transcript" i]',
            '[role="tab"][data-purpose*="transcript" i]',
            'svg[aria-label*="transcript" i]',
            clickableSelector
          ].join(", ")
        )
      ).map(toClickable)
    )
  )

  const transcriptCandidates = candidates.filter((candidate) => {
    const text = normalizeTranscriptLine(candidate.textContent || "")
    const ariaLabel = candidate.getAttribute("aria-label") || ""
    const dataPurpose = candidate.getAttribute("data-purpose") || ""
    const iconAriaLabel =
      candidate
        .querySelector<HTMLElement>('svg[aria-label*="transcript" i]')
        ?.getAttribute("aria-label") || ""

    return (
      text.toLowerCase() === "transcript" ||
      text.toLowerCase().includes("transcript") ||
      ariaLabel.toLowerCase().includes("transcript") ||
      dataPurpose.toLowerCase().includes("transcript") ||
      iconAriaLabel.toLowerCase().includes("transcript")
    )
  })

  return transcriptCandidates.find(isVisible) || transcriptCandidates[0] || null
}

const dispatchMouseEvent = (element: HTMLElement, type: string): void => {
  element.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window
    })
  )
}

const dispatchPointerEvent = (element: HTMLElement, type: string): void => {
  if (typeof PointerEvent === "function") {
    element.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true
      })
    )
    return
  }

  dispatchMouseEvent(element, type.replace("pointer", "mouse"))
}

const clickTranscriptButton = async (
  transcriptButton: HTMLElement
): Promise<void> => {
  transcriptButton.scrollIntoView({ block: "center", inline: "center" })
  transcriptButton.focus()

  dispatchPointerEvent(transcriptButton, "pointerover")
  dispatchMouseEvent(transcriptButton, "mouseover")
  dispatchPointerEvent(transcriptButton, "pointerdown")
  dispatchMouseEvent(transcriptButton, "mousedown")
  dispatchPointerEvent(transcriptButton, "pointerup")
  dispatchMouseEvent(transcriptButton, "mouseup")
  transcriptButton.click()

  await sleep(500)
}

const wakePlayerControls = async (): Promise<void> => {
  const targets = Array.from(
    document.querySelectorAll<HTMLElement>(
      [
        '[data-purpose="video-player"]',
        '[class*="video-player"]',
        '[class*="video-viewer"]',
        "video",
        "body"
      ].join(", ")
    )
  )

  logger.debug("Waking Udemy player controls", "TranscriptExtractor", {
    targets: targets.length,
    toggles: document.querySelectorAll(TRANSCRIPT_TOGGLE_SELECTOR).length
  })

  for (const target of targets.slice(0, 5)) {
    dispatchPointerEvent(target, "pointerover")
    dispatchMouseEvent(target, "mouseover")
    dispatchPointerEvent(target, "pointermove")
    dispatchMouseEvent(target, "mousemove")
  }

  await sleep(300)
}

const openTranscript = async (): Promise<boolean> => {
  if (!isUdemyLecturePage()) return false
  if (document.querySelector(TRANSCRIPT_PANEL_SELECTOR)) return true

  let transcriptButton: HTMLElement | null = null
  for (let attempt = 1; attempt <= 10; attempt++) {
    transcriptButton = findTranscriptButton()
    if (transcriptButton) break

    logger.debug(
      `Udemy transcript button not found, retrying (${attempt}/10)`,
      "TranscriptExtractor",
      {
        toggles: document.querySelectorAll(TRANSCRIPT_TOGGLE_SELECTOR).length
      }
    )
    if (attempt < 10) {
      await wakePlayerControls()
    }
  }

  if (!transcriptButton) {
    logger.debug("Udemy transcript button not found", "TranscriptExtractor")
    return false
  }

  logger.info("Clicking Udemy transcript button", "TranscriptExtractor", {
    text: normalizeTranscriptLine(transcriptButton.textContent || ""),
    ariaLabel: transcriptButton.getAttribute("aria-label"),
    ariaExpanded: transcriptButton.getAttribute("aria-expanded"),
    dataPurpose: transcriptButton.getAttribute("data-purpose"),
    iconAriaLabel:
      transcriptButton
        .querySelector<HTMLElement>('svg[aria-label*="transcript" i]')
        ?.getAttribute("aria-label") || null,
    role: transcriptButton.getAttribute("role"),
    tag: transcriptButton.tagName.toLowerCase()
  })

  await clickTranscriptButton(transcriptButton)

  const panel = await waitForElement(TRANSCRIPT_PANEL_SELECTOR, 30, 300)
  return !!panel
}

export const extractUdemyTranscript = async (): Promise<string | null> => {
  if (!isUdemyLecturePage()) return null

  const existingTranscript = extractPanelTranscript()
  if (existingTranscript) return existingTranscript

  const opened = await openTranscript()
  logger.debug(`Udemy panel open result: ${opened}`, "TranscriptExtractor")

  return extractPanelTranscript()
}
