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
      console.log(
        `[YouTube Transcript] Found element with selector "${selector}" after ${i + 1} attempts`
      )
      return element
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
  console.log(
    `[YouTube Transcript] Element "${selector}" not found after ${maxAttempts} attempts`
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
  console.log("[YouTube Transcript] Starting transcript panel automation")
  console.log(`[YouTube Transcript] Current URL: ${window.location.href}`)

  if (!window.location.href.includes("youtube.com/watch")) {
    console.log("[YouTube Transcript] Not a YouTube watch page, skipping")
    return false
  }

  console.log("[YouTube Transcript] Checking for existing transcript panel...")
  // Check if transcript is already open
  const existingTranscript = document.querySelector("ytd-transcript-renderer")
  if (existingTranscript) {
    console.log("[YouTube Transcript] Transcript panel already exists!")
    return true
  }

  console.log(
    "[YouTube Transcript] Transcript panel not found, attempting to open..."
  )

  // Step 1: Try to click "more" button to expand description
  console.log("[YouTube Transcript] Step 1: Looking for 'more' button...")
  const moreButton = await waitForElement(
    "tp-yt-paper-button#expand.button.style-scope.ytd-text-inline-expander",
    3,
    300
  )

  if (moreButton) {
    const moreButtonText = moreButton.textContent?.trim() || ""
    console.log(
      `[YouTube Transcript] Found 'more' button with text: "${moreButtonText}"`
    )
    if (moreButtonText.includes("more") || moreButtonText.includes("...")) {
      console.log("[YouTube Transcript] Clicking 'more' button...")
      moreButton.click()
      // Wait for description to expand
      await new Promise((resolve) => setTimeout(resolve, 500))
      console.log("[YouTube Transcript] Waited 500ms for description to expand")
    } else {
      console.log(
        `[YouTube Transcript] 'more' button found but text doesn't match: "${moreButtonText}"`
      )
    }
  } else {
    console.log(
      "[YouTube Transcript] 'more' button not found (may already be expanded)"
    )
  }

  // Step 2: Try to find and click "Show transcript" button with retries
  console.log(
    "[YouTube Transcript] Step 2: Looking for 'Show transcript' button..."
  )

  let transcriptButton: HTMLElement | null = null
  const maxRetries = 5

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(
      `[YouTube Transcript] Attempt ${attempt}/${maxRetries} to find transcript button...`
    )

    // Strategy 1: Find the transcript section renderer and get the button from it
    const transcriptSection = document.querySelector<HTMLElement>(
      "ytd-video-description-transcript-section-renderer"
    )
    if (transcriptSection) {
      console.log("[YouTube Transcript] Found transcript section renderer")

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
          console.log(
            "[YouTube Transcript] Found button inside transcript section"
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
              console.log(
                "[YouTube Transcript] Found button by traversing up from touch feedback"
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
            console.log(
              `[YouTube Transcript] Found button via selector: ${selector}`
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
      console.log(
        `[YouTube Transcript] Found ${touchFeedbackDivs.length} touch feedback divs`
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
              console.log(
                "[YouTube Transcript] Found button by traversing touch feedback div"
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
      console.log(
        `[YouTube Transcript] Found ${allButtons.length} potential buttons for text search`
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
        console.log(`[YouTube Transcript] Found button via text search`)
      }
    }

    if (transcriptButton) {
      const buttonText = transcriptButton.textContent?.trim() || ""
      const ariaLabel = transcriptButton.getAttribute("aria-label") || ""
      console.log(`[YouTube Transcript] Found transcript button!`)
      console.log(`[YouTube Transcript] Button text: "${buttonText}"`)
      console.log(`[YouTube Transcript] Button aria-label: "${ariaLabel}"`)
      console.log(
        `[YouTube Transcript] Button tag: ${transcriptButton.tagName}`
      )
      console.log(
        `[YouTube Transcript] Button classes: ${transcriptButton.className}`
      )
      console.log(`[YouTube Transcript] Button element:`, transcriptButton)
      console.log(`[YouTube Transcript] Clicking transcript button...`)

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
      console.log(
        "[YouTube Transcript] Waited 1500ms for transcript panel to appear"
      )

      // Verify transcript panel appeared
      const transcriptPanel = document.querySelector("ytd-transcript-renderer")
      if (transcriptPanel) {
        console.log(
          "[YouTube Transcript] Transcript panel successfully opened!"
        )
        return true
      } else {
        console.log(
          "[YouTube Transcript] Transcript panel not found after clicking, waiting longer..."
        )
        // Wait a bit more and retry
        await new Promise((resolve) => setTimeout(resolve, 1500))
        const retryPanel = document.querySelector("ytd-transcript-renderer")
        if (retryPanel) {
          console.log(
            "[YouTube Transcript] Transcript panel appeared after longer wait!"
          )
          return true
        }
      }
    }

    if (attempt < maxRetries) {
      console.log(`[YouTube Transcript] Waiting before retry ${attempt + 1}...`)
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  console.log(
    "[YouTube Transcript] Transcript button not found after all retries"
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
  console.log("[YouTube Transcript] Sample buttons found:", buttonTexts)
  return false
}

const extractYouTubeTranscript = async (): Promise<string | null> => {
  console.log("[YouTube Transcript] Starting transcript extraction...")

  if (!window.location.href.includes("youtube.com/watch")) {
    console.log("[YouTube Transcript] Not a YouTube watch page")
    return null
  }

  // Try to open transcript panel if not already open
  console.log("[YouTube Transcript] Attempting to open transcript panel...")
  const opened = await openYouTubeTranscript()
  console.log(`[YouTube Transcript] Panel open result: ${opened}`)

  const transcriptContainer = document.querySelector("ytd-transcript-renderer")
  if (!transcriptContainer) {
    console.log(
      "[YouTube Transcript] Transcript container not found after opening attempt"
    )
    return null
  }

  console.log(
    "[YouTube Transcript] Transcript container found, extracting content..."
  )

  const transcriptLines = transcriptContainer.querySelectorAll("div.cue-group")
  const fallbackLines = transcriptContainer.querySelectorAll(
    "yt-formatted-string"
  )
  const lines = transcriptLines.length > 0 ? transcriptLines : fallbackLines

  console.log(`[YouTube Transcript] Found ${lines.length} transcript lines`)

  if (lines.length === 0) {
    console.log("[YouTube Transcript] No transcript lines found")
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
    console.log(
      `[YouTube Transcript] Successfully extracted transcript (${result.length} chars)`
    )
  } else {
    console.log("[YouTube Transcript] Empty transcript after processing")
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
  console.log(
    "[Transcript Extractor] Starting transcript extraction for current page"
  )
  console.log(`[Transcript Extractor] Current URL: ${window.location.href}`)

  const youtubeTranscript = await extractYouTubeTranscript()
  if (youtubeTranscript) {
    console.log("[Transcript Extractor] YouTube transcript found")
    return youtubeTranscript
  }

  console.log("[Transcript Extractor] Trying Udemy transcript...")
  const udemyTranscript = extractUdemyTranscript()
  if (udemyTranscript) {
    console.log("[Transcript Extractor] Udemy transcript found")
    return udemyTranscript
  }

  console.log("[Transcript Extractor] Trying Coursera transcript...")
  const courseraTranscript = extractCourseraTranscript()
  if (courseraTranscript) {
    console.log("[Transcript Extractor] Coursera transcript found")
    return courseraTranscript
  }

  console.log(
    "[Transcript Extractor] No transcript found for any supported platform"
  )
  return null
}
