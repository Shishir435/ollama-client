import { logger } from "@/lib/logger"

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
  const existingTranscript = document.querySelector("ytd-transcript-renderer")
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
      const transcriptPanel = document.querySelector("ytd-transcript-renderer")
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
        const retryPanel = document.querySelector("ytd-transcript-renderer")
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

const extractYouTubeTranscript = async (): Promise<string | null> => {
  logger.debug("Starting transcript extraction...", "TranscriptExtractor")

  if (!window.location.href.includes("youtube.com/watch")) {
    logger.debug("Not a YouTube watch page", "TranscriptExtractor")
    return null
  }

  // Try to open transcript panel if not already open
  logger.debug("Attempting to open transcript panel...", "TranscriptExtractor")
  const opened = await openYouTubeTranscript()
  logger.debug(`Panel open result: ${opened}`, "TranscriptExtractor")

  const transcriptContainer = document.querySelector("ytd-transcript-renderer")
  if (!transcriptContainer) {
    logger.debug(
      "Transcript container not found after opening attempt",
      "TranscriptExtractor"
    )
    return null
  }

  logger.debug(
    "Transcript container found, extracting content...",
    "TranscriptExtractor"
  )

  const transcriptLines = transcriptContainer.querySelectorAll("div.cue-group")
  const fallbackLines = transcriptContainer.querySelectorAll(
    "yt-formatted-string"
  )
  const lines = transcriptLines.length > 0 ? transcriptLines : fallbackLines

  logger.debug(`Found ${lines.length} transcript lines`, "TranscriptExtractor")

  if (lines.length === 0) {
    logger.debug("No transcript lines found", "TranscriptExtractor")
    return null
  }

  const transcript = Array.from(lines)
    .map((group) => {
      const cueText = group.querySelector?.(".cue")?.textContent?.trim()
      return cueText ?? group.textContent?.trim() ?? ""
    })
    .filter(Boolean)
    .join("\n")

  const result = transcript.length > 0 ? transcript : null
  if (result) {
    logger.debug(
      `Successfully extracted transcript (${result.length} chars)`,
      "TranscriptExtractor"
    )
  } else {
    logger.debug("Empty transcript after processing", "TranscriptExtractor")
  }

  return result
}

const extractUdemyTranscript = (): string | null => {
  if (
    !(
      window.location.href.includes("udemy.com/course/") &&
      window.location.href.includes("/learn/lecture/")
    )
  )
    return null

  const transcriptPanel = document.querySelector(
    '[data-purpose="transcript-panel"]'
  )
  if (!transcriptPanel) return null

  const cues = transcriptPanel.querySelectorAll('[data-purpose="cue-text"]')
  if (!cues || cues.length === 0) return null

  const transcript = Array.from(cues)
    .map((cue) => cue.textContent?.trim())
    .filter(Boolean)
    .join("\n")

  return transcript.length > 0 ? transcript : null
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
  const udemyTranscript = extractUdemyTranscript()
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
