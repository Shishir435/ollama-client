import { logger } from "@/lib/logger"

type YouTubeCaptionTrack = {
  baseUrl?: string
  kind?: string
  languageCode?: string
  name?: {
    simpleText?: string
    runs?: Array<{ text?: string }>
  }
}

type YouTubePlayerResponse = {
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: YouTubeCaptionTrack[]
    }
  }
}

const YOUTUBE_TRANSCRIPT_PANEL_SELECTOR =
  'ytd-transcript-renderer, yt-section-list-renderer[data-target-id="PAmodern_transcript_view"], yt-section-list-renderer[panel-target-id="PAmodern_transcript_view"]'

const MODERN_TRANSCRIPT_SEGMENT_SELECTOR = "transcript-segment-view-model"
const LEGACY_TRANSCRIPT_SEGMENT_SELECTOR =
  "div.cue-group, ytd-transcript-segment-renderer"
const UDEMY_TRANSCRIPT_PANEL_SELECTOR = '[data-purpose="transcript-panel"]'
const UDEMY_TRANSCRIPT_CUE_SELECTOR = '[data-purpose="cue-text"]'
const UDEMY_TRANSCRIPT_TOGGLE_SELECTOR =
  'button[data-purpose="transcript-toggle"], [data-purpose="transcript-toggle"], svg[aria-label*="transcript" i]'

/**
 * Waits for an element to appear in the DOM with retries
 */
const waitForElement = async (
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
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
  logger.debug(
    `Element "${selector}" not found after ${maxAttempts} attempts`,
    "TranscriptExtractor"
  )
  return null
}

const sleep = (delayMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, delayMs))

/**
 * Attempts to open the YouTube transcript panel by clicking:
 * 1. The "more" button in description (if collapsed)
 * 2. The "Show transcript" button
 * Returns true if transcript panel was opened or already exists
 */
const openYouTubeTranscript = async (): Promise<boolean> => {
  logger.debug("Starting transcript panel automation", "TranscriptExtractor")
  logger.debug(`Current URL: ${window.location.href}`, "TranscriptExtractor")

  if (!window.location.href.includes("youtube.com/watch")) {
    logger.debug("Not a YouTube watch page, skipping", "TranscriptExtractor")
    return false
  }

  logger.debug(
    "Checking for existing transcript panel...",
    "TranscriptExtractor"
  )
  // Check if transcript is already open
  const existingTranscript = document.querySelector(
    YOUTUBE_TRANSCRIPT_PANEL_SELECTOR
  )
  if (existingTranscript) {
    logger.debug("Transcript panel already exists!", "TranscriptExtractor")
    return true
  }

  logger.debug(
    "Transcript panel not found, attempting to open...",
    "TranscriptExtractor"
  )

  // Step 1: Try to click "more" button to expand description
  logger.debug("Step 1: Looking for 'more' button...", "TranscriptExtractor")
  const moreButton = await waitForElement(
    "tp-yt-paper-button#expand.button.style-scope.ytd-text-inline-expander",
    3,
    300
  )

  if (moreButton) {
    const moreButtonText = moreButton.textContent?.trim() || ""
    logger.debug(
      `Found 'more' button with text: "${moreButtonText}"`,
      "TranscriptExtractor"
    )
    if (moreButtonText.includes("more") || moreButtonText.includes("...")) {
      logger.debug("Clicking 'more' button...", "TranscriptExtractor")
      moreButton.click()
      // Wait for description to expand
      await new Promise((resolve) => setTimeout(resolve, 500))
      logger.debug(
        "Waited 500ms for description to expand",
        "TranscriptExtractor"
      )
    } else {
      logger.debug(
        `'more' button found but text doesn't match: "${moreButtonText}"`,
        "TranscriptExtractor"
      )
    }
  } else {
    logger.debug(
      "'more' button not found (may already be expanded)",
      "TranscriptExtractor"
    )
  }

  // Step 2: Try to find and click "Show transcript" button with retries
  logger.debug(
    "Step 2: Looking for 'Show transcript' button...",
    "TranscriptExtractor"
  )

  let transcriptButton: HTMLElement | null = null
  const maxRetries = 5

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    logger.debug(
      `Attempt ${attempt}/${maxRetries} to find transcript button...`,
      "TranscriptExtractor"
    )

    // Strategy 1: Find the transcript section renderer and get the button from it
    const transcriptSection = document.querySelector<HTMLElement>(
      "ytd-video-description-transcript-section-renderer"
    )
    if (transcriptSection) {
      logger.debug("Found transcript section renderer", "TranscriptExtractor")

      // Try to find the button inside the section
      const buttonInside = transcriptSection.querySelector<HTMLElement>(
        "button.yt-spec-button-shape-next, ytd-button-renderer button, #primary-button button"
      )
      if (buttonInside) {
        const text = buttonInside.textContent?.trim() || ""
        const ariaLabel = buttonInside.getAttribute("aria-label") || ""
        if (
          text.toLowerCase().includes("transcript") ||
          text.toLowerCase().includes("show transcript") ||
          ariaLabel.toLowerCase().includes("transcript")
        ) {
          transcriptButton = buttonInside
          logger.debug(
            "Found button inside transcript section",
            "TranscriptExtractor"
          )
        }
      }

      // If button not found, try the touch feedback div and traverse up
      if (!transcriptButton) {
        const touchFeedback = transcriptSection.querySelector<HTMLElement>(
          "div.yt-spec-touch-feedback-shape__fill"
        )
        if (touchFeedback) {
          // Traverse up to find the actual button element
          let current: HTMLElement | null = touchFeedback.parentElement
          while (current && current !== transcriptSection) {
            if (
              current.tagName === "BUTTON" ||
              current.classList.contains("yt-spec-button-shape-next")
            ) {
              transcriptButton = current
              logger.debug(
                "Found button by traversing up from touch feedback",
                "TranscriptExtractor"
              )
              break
            }
            current = current.parentElement
          }
        }
      }
    }

    // Strategy 2: Find button by specific selectors
    if (!transcriptButton) {
      const selectors = [
        'button[aria-label*="transcript" i]',
        'button[aria-label*="Show transcript" i]',
        "ytd-button-renderer button",
        "button.yt-spec-button-shape-next"
      ]

      for (const selector of selectors) {
        const buttons = Array.from(
          document.querySelectorAll<HTMLElement>(selector)
        )
        for (const button of buttons) {
          const text = button.textContent?.trim() || ""
          const ariaLabel = button.getAttribute("aria-label") || ""
          if (
            text.toLowerCase().includes("transcript") ||
            text.toLowerCase().includes("show transcript") ||
            ariaLabel.toLowerCase().includes("transcript")
          ) {
            transcriptButton = button
            logger.debug(
              `Found button via selector: ${selector}`,
              "TranscriptExtractor"
            )
            break
          }
        }
        if (transcriptButton) break
      }
    }

    // Strategy 3: Find touch feedback div and traverse to find button
    if (!transcriptButton) {
      const touchFeedbackDivs = Array.from(
        document.querySelectorAll<HTMLElement>(
          "div.yt-spec-touch-feedback-shape__fill"
        )
      )
      logger.debug(
        `Found ${touchFeedbackDivs.length} touch feedback divs`,
        "TranscriptExtractor"
      )

      for (const div of touchFeedbackDivs) {
        // Check if this div is inside a transcript section
        const parentSection = div.closest(
          "ytd-video-description-transcript-section-renderer"
        )
        if (parentSection) {
          // Traverse up to find button
          let current: HTMLElement | null = div.parentElement
          while (current && current !== parentSection) {
            if (
              current.tagName === "BUTTON" ||
              current.classList.contains("yt-spec-button-shape-next")
            ) {
              transcriptButton = current
              logger.debug(
                "Found button by traversing touch feedback div",
                "TranscriptExtractor"
              )
              break
            }
            current = current.parentElement
          }
          if (transcriptButton) break
        }
      }
    }

    // Strategy 4: Text-based search as fallback
    if (!transcriptButton) {
      const allButtons = Array.from(
        document.querySelectorAll<HTMLElement>("button, div[role='button']")
      )
      logger.debug(
        `Found ${allButtons.length} potential buttons for text search`,
        "TranscriptExtractor"
      )

      transcriptButton =
        (allButtons.find((btn) => {
          const text = btn.textContent?.trim() || ""
          const ariaLabel = btn.getAttribute("aria-label") || ""
          return (
            text.toLowerCase().includes("transcript") ||
            text.toLowerCase().includes("show transcript") ||
            ariaLabel.toLowerCase().includes("transcript")
          )
        }) as HTMLElement | undefined) || null

      if (transcriptButton) {
        logger.debug("Found button via text search", "TranscriptExtractor")
      }
    }

    if (transcriptButton) {
      const buttonText = transcriptButton.textContent?.trim() || ""
      const ariaLabel = transcriptButton.getAttribute("aria-label") || ""
      logger.debug("Found transcript button!", "TranscriptExtractor", {
        buttonText,
        ariaLabel,
        tag: transcriptButton.tagName,
        classes: transcriptButton.className
      })
      logger.debug("Clicking transcript button...", "TranscriptExtractor")

      // Try multiple click methods to ensure it works
      // Method 1: Direct click
      transcriptButton.click()

      // Method 2: Dispatch pointer event (more realistic)
      transcriptButton.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          pointerType: "mouse"
        })
      )
      transcriptButton.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          pointerType: "mouse"
        })
      )

      // Method 3: Dispatch click event
      transcriptButton.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window
        })
      )

      // Wait for transcript panel to appear
      await new Promise((resolve) => setTimeout(resolve, 1500))
      logger.debug(
        "Waited 1500ms for transcript panel to appear",
        "TranscriptExtractor"
      )

      // Verify transcript panel appeared
      const transcriptPanel = document.querySelector(
        YOUTUBE_TRANSCRIPT_PANEL_SELECTOR
      )
      if (transcriptPanel) {
        logger.debug(
          "Transcript panel successfully opened!",
          "TranscriptExtractor"
        )
        return true
      } else {
        logger.debug(
          "Transcript panel not found after clicking, waiting longer...",
          "TranscriptExtractor"
        )
        // Wait a bit more and retry
        await new Promise((resolve) => setTimeout(resolve, 1500))
        const retryPanel = document.querySelector(
          YOUTUBE_TRANSCRIPT_PANEL_SELECTOR
        )
        if (retryPanel) {
          logger.debug(
            "Transcript panel appeared after longer wait!",
            "TranscriptExtractor"
          )
          return true
        }
      }
    }

    if (attempt < maxRetries) {
      logger.debug(
        `Waiting before retry ${attempt + 1}...`,
        "TranscriptExtractor"
      )
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  logger.debug(
    "Transcript button not found after all retries",
    "TranscriptExtractor"
  )
  // Log some button texts for debugging
  const allButtons = Array.from(
    document.querySelectorAll("button, div[role='button']")
  )
  const buttonTexts = allButtons
    .slice(0, 20)
    .map((btn) => ({
      text: btn.textContent?.trim(),
      ariaLabel: btn.getAttribute("aria-label"),
      tag: btn.tagName,
      classes: btn.className
    }))
    .filter((info) => info.text || info.ariaLabel)
  logger.debug("Sample buttons found", "TranscriptExtractor", { buttonTexts })
  return false
}

const extractBalancedJson = (
  source: string,
  startIndex: number
): string | null => {
  let depth = 0
  let inString = false
  let escapeNext = false

  for (let i = startIndex; i < source.length; i++) {
    const char = source[i]

    if (escapeNext) {
      escapeNext = false
      continue
    }

    if (char === "\\") {
      escapeNext = true
      continue
    }

    if (char === '"') {
      inString = !inString
      continue
    }

    if (inString) continue

    if (char === "{") {
      depth++
    } else if (char === "}") {
      depth--
      if (depth === 0) return source.slice(startIndex, i + 1)
    }
  }

  return null
}

const getYouTubePlayerResponse = (): YouTubePlayerResponse | null => {
  const scripts = Array.from(document.querySelectorAll("script"))

  for (const script of scripts) {
    const text = script.textContent || ""
    const markerIndex = text.indexOf("ytInitialPlayerResponse")
    if (markerIndex === -1) continue

    const jsonStart = text.indexOf("{", markerIndex)
    if (jsonStart === -1) continue

    const jsonText = extractBalancedJson(text, jsonStart)
    if (!jsonText) continue

    try {
      return JSON.parse(jsonText) as YouTubePlayerResponse
    } catch (error) {
      logger.debug(
        "Failed to parse ytInitialPlayerResponse",
        "TranscriptExtractor",
        {
          error
        }
      )
    }
  }

  return null
}

const normalizeTranscriptLine = (text: string): string =>
  text.replace(/\s+/g, " ").trim()

const getCaptionTrackLabel = (track: YouTubeCaptionTrack): string => {
  return (
    track.name?.simpleText ||
    track.name?.runs?.map((run) => run.text || "").join("") ||
    ""
  )
}

const selectCaptionTrack = (
  tracks: YouTubeCaptionTrack[]
): YouTubeCaptionTrack | null => {
  const usableTracks = tracks.filter((track) => track.baseUrl)
  if (usableTracks.length === 0) return null

  return (
    usableTracks.find(
      (track) => track.languageCode?.startsWith("en") && track.kind !== "asr"
    ) ||
    usableTracks.find((track) => track.languageCode?.startsWith("en")) ||
    usableTracks.find((track) => track.kind !== "asr") ||
    usableTracks[0] ||
    null
  )
}

const parseJson3Transcript = (payload: unknown): string | null => {
  if (!payload || typeof payload !== "object") return null

  const events = (payload as { events?: unknown }).events
  if (!Array.isArray(events)) return null

  const transcript = events
    .map((event) => {
      const segs = (event as { segs?: unknown }).segs
      if (!Array.isArray(segs)) return ""
      return segs
        .map((seg) => (seg as { utf8?: unknown }).utf8)
        .filter((text): text is string => typeof text === "string")
        .join("")
    })
    .map(normalizeTranscriptLine)
    .filter(Boolean)
    .join("\n")

  return transcript || null
}

const parseXmlTranscript = (payload: string): string | null => {
  const doc = new DOMParser().parseFromString(payload, "text/xml")
  const transcript = Array.from(doc.querySelectorAll("text"))
    .map((node) => normalizeTranscriptLine(node.textContent || ""))
    .filter(Boolean)
    .join("\n")

  return transcript || null
}

const fetchYouTubeCaptionTranscript = async (): Promise<string | null> => {
  const playerResponse = getYouTubePlayerResponse()
  const tracks =
    playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks ||
    []
  const selectedTrack = selectCaptionTrack(tracks)

  if (!selectedTrack?.baseUrl) {
    logger.debug(
      "No usable YouTube caption tracks found",
      "TranscriptExtractor",
      {
        count: tracks.length
      }
    )
    return null
  }

  logger.info("Using YouTube caption track", "TranscriptExtractor", {
    count: tracks.length,
    selected: getCaptionTrackLabel(selectedTrack)
  })

  try {
    const captionUrl = new URL(selectedTrack.baseUrl)
    captionUrl.searchParams.set("fmt", "json3")
    const response = await fetch(captionUrl.toString())
    if (!response.ok) {
      logger.warn("YouTube caption fetch failed", "TranscriptExtractor", {
        status: response.status
      })
      return null
    }

    const text = await response.text()
    if (!text.trim()) {
      logger.warn("YouTube caption response was empty", "TranscriptExtractor", {
        languageCode: selectedTrack.languageCode,
        kind: selectedTrack.kind
      })
      return null
    }

    try {
      return parseJson3Transcript(JSON.parse(text))
    } catch {
      return parseXmlTranscript(text)
    }
  } catch (error) {
    logger.warn("YouTube caption transcript failed", "TranscriptExtractor", {
      error
    })
    return null
  }
}

const extractTextFromYouTubeSegment = (segment: Element): string => {
  const modernText = segment.querySelector<HTMLElement>(
    '.ytAttributedStringHost[role="text"], span[role="text"]'
  )
  if (modernText?.textContent)
    return normalizeTranscriptLine(modernText.textContent)

  const legacyText = segment.querySelector<HTMLElement>(
    ".cue, .segment-text, yt-formatted-string"
  )
  if (legacyText?.textContent)
    return normalizeTranscriptLine(legacyText.textContent)

  const clone = segment.cloneNode(true) as Element
  clone
    .querySelectorAll(
      '[aria-hidden="true"], .ytwTranscriptSegmentViewModelTimestamp, .ytwTranscriptSegmentViewModelTimestampA11yLabel'
    )
    .forEach((node) => {
      node.remove()
    })

  return normalizeTranscriptLine(clone.textContent || "")
}

const extractYouTubePanelTranscript = (): string | null => {
  const transcriptContainer = document.querySelector(
    YOUTUBE_TRANSCRIPT_PANEL_SELECTOR
  )
  if (!transcriptContainer) {
    logger.debug("Transcript container not found", "TranscriptExtractor")
    return null
  }

  logger.debug(
    "Transcript container found, extracting content...",
    "TranscriptExtractor"
  )

  const modernSegments = transcriptContainer.querySelectorAll(
    MODERN_TRANSCRIPT_SEGMENT_SELECTOR
  )
  const legacySegments = transcriptContainer.querySelectorAll(
    LEGACY_TRANSCRIPT_SEGMENT_SELECTOR
  )
  const segments =
    modernSegments.length > 0
      ? modernSegments
      : legacySegments.length > 0
        ? legacySegments
        : transcriptContainer.querySelectorAll(
            ".cue, .segment-text, ytd-transcript-segment-renderer yt-formatted-string"
          )

  logger.info(
    `Found ${segments.length} transcript segments in panel`,
    "TranscriptExtractor",
    {
      panelTag: transcriptContainer.tagName.toLowerCase(),
      modernSegments: modernSegments.length,
      legacySegments: legacySegments.length
    }
  )

  if (segments.length === 0) return null

  const transcript = Array.from(segments)
    .map(extractTextFromYouTubeSegment)
    .filter(Boolean)
    .join("\n")

  return transcript || null
}

const extractYouTubeTranscript = async (): Promise<string | null> => {
  if (!window.location.href.includes("youtube.com/watch")) {
    logger.debug("Not a YouTube watch page", "TranscriptExtractor")
    return null
  }

  logger.info("Starting YouTube transcript extraction", "TranscriptExtractor")

  const existingPanelTranscript = extractYouTubePanelTranscript()
  if (existingPanelTranscript) {
    logger.info(
      `Successfully extracted open panel transcript (${existingPanelTranscript.length} chars)`,
      "TranscriptExtractor"
    )
    return existingPanelTranscript
  }

  const captionTranscript = await fetchYouTubeCaptionTranscript()
  if (captionTranscript) {
    logger.info(
      `Successfully extracted caption transcript (${captionTranscript.length} chars)`,
      "TranscriptExtractor"
    )
    return captionTranscript
  }

  // Try to open transcript panel if not already open
  logger.debug("Attempting to open transcript panel...", "TranscriptExtractor")
  const opened = await openYouTubeTranscript()
  logger.debug(`Panel open result: ${opened}`, "TranscriptExtractor")

  const result = extractYouTubePanelTranscript()
  if (result) {
    logger.info(
      `Successfully extracted transcript (${result.length} chars)`,
      "TranscriptExtractor"
    )
  } else {
    logger.debug("Empty transcript after processing", "TranscriptExtractor")
  }

  return result
}

const isUdemyLecturePage = (): boolean =>
  window.location.href.includes("udemy.com/course/") &&
  window.location.href.includes("/learn/lecture/")

const extractUdemyPanelTranscript = (): string | null => {
  const transcriptPanel = document.querySelector(
    UDEMY_TRANSCRIPT_PANEL_SELECTOR
  )
  if (!transcriptPanel) return null

  const cues = transcriptPanel.querySelectorAll(UDEMY_TRANSCRIPT_CUE_SELECTOR)
  logger.info(
    `Found ${cues.length} Udemy transcript cues`,
    "TranscriptExtractor"
  )
  if (!cues || cues.length === 0) return null

  const transcript = Array.from(cues)
    .map((cue) => normalizeTranscriptLine(cue.textContent || ""))
    .filter(Boolean)
    .join("\n")

  return transcript.length > 0 ? transcript : null
}

const findUdemyTranscriptButton = (): HTMLElement | null => {
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
            UDEMY_TRANSCRIPT_TOGGLE_SELECTOR,
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

const clickUdemyTranscriptButton = async (
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

const wakeUdemyPlayerControls = async (): Promise<void> => {
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
    toggles: document.querySelectorAll(UDEMY_TRANSCRIPT_TOGGLE_SELECTOR).length
  })

  for (const target of targets.slice(0, 5)) {
    dispatchPointerEvent(target, "pointerover")
    dispatchMouseEvent(target, "mouseover")
    dispatchPointerEvent(target, "pointermove")
    dispatchMouseEvent(target, "mousemove")
  }

  await sleep(300)
}

const openUdemyTranscript = async (): Promise<boolean> => {
  if (!isUdemyLecturePage()) return false
  if (document.querySelector(UDEMY_TRANSCRIPT_PANEL_SELECTOR)) return true

  let transcriptButton: HTMLElement | null = null
  for (let attempt = 1; attempt <= 10; attempt++) {
    transcriptButton = findUdemyTranscriptButton()
    if (transcriptButton) break

    logger.debug(
      `Udemy transcript button not found, retrying (${attempt}/10)`,
      "TranscriptExtractor",
      {
        toggles: document.querySelectorAll(UDEMY_TRANSCRIPT_TOGGLE_SELECTOR)
          .length
      }
    )
    if (attempt < 10) {
      await wakeUdemyPlayerControls()
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

  await clickUdemyTranscriptButton(transcriptButton)

  const panel = await waitForElement(UDEMY_TRANSCRIPT_PANEL_SELECTOR, 30, 300)
  return !!panel
}

const extractUdemyTranscript = async (): Promise<string | null> => {
  if (!isUdemyLecturePage()) return null

  const existingTranscript = extractUdemyPanelTranscript()
  if (existingTranscript) return existingTranscript

  const opened = await openUdemyTranscript()
  logger.debug(`Udemy panel open result: ${opened}`, "TranscriptExtractor")

  return extractUdemyPanelTranscript()
}

const extractCourseraTranscript = (): string | null => {
  if (
    !window.location.href.includes("coursera.org/learn/") ||
    !window.location.href.includes("/lecture/")
  ) {
    return null
  }
  const transcript = Array.from(document.querySelectorAll(".rc-Phrase"))
    .map((phrase) => phrase.textContent)
    .join(" ")

  return transcript.length > 0 ? transcript : null
}

export const getTranscript = async (): Promise<string | null> => {
  logger.info(
    "Starting transcript extraction for current page",
    "TranscriptExtractor"
  )
  logger.debug(`Current URL: ${window.location.href}`, "TranscriptExtractor")

  const youtubeTranscript = await extractYouTubeTranscript()
  if (youtubeTranscript) {
    logger.info("YouTube transcript found", "TranscriptExtractor")
    return youtubeTranscript
  }

  logger.debug("Trying Udemy transcript...", "TranscriptExtractor")
  const udemyTranscript = await extractUdemyTranscript()
  if (udemyTranscript) {
    logger.info("Udemy transcript found", "TranscriptExtractor")
    return udemyTranscript
  }

  logger.debug("Trying Coursera transcript...", "TranscriptExtractor")
  const courseraTranscript = extractCourseraTranscript()
  if (courseraTranscript) {
    logger.info("Coursera transcript found", "TranscriptExtractor")
    return courseraTranscript
  }

  logger.debug(
    "No transcript found for any supported platform",
    "TranscriptExtractor"
  )
  return null
}
