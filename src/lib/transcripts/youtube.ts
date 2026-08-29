import { logger } from "@/lib/logger"
import {
  formatTranscriptTimestamp,
  normalizeTranscriptTimestamp,
  waitForElement,
  withTranscriptTimestamp
} from "@/lib/transcripts/shared"
import { getYouTubeVideoId, isYouTubeVideoPage } from "@/lib/youtube-url"

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
  /** Which video this payload describes — the staleness check below needs it. */
  videoDetails?: {
    videoId?: string
  }
}

const YOUTUBE_TRANSCRIPT_PANEL_SELECTOR =
  'ytd-transcript-renderer, yt-section-list-renderer[data-target-id="PAmodern_transcript_view"], yt-section-list-renderer[panel-target-id="PAmodern_transcript_view"]'

const MODERN_TRANSCRIPT_SEGMENT_SELECTOR = "transcript-segment-view-model"
const LEGACY_TRANSCRIPT_SEGMENT_SELECTOR =
  "div.cue-group, ytd-transcript-segment-renderer"
/**
 * Attempts to open the YouTube transcript panel by clicking:
 * 1. The "more" button in description (if collapsed)
 * 2. The "Show transcript" button
 * Returns true if transcript panel was opened or already exists
 */
const isTranscriptButton = (button: HTMLElement): boolean => {
  const text = button.textContent?.trim().toLowerCase() || ""
  const ariaLabel = button.getAttribute("aria-label")?.toLowerCase() || ""
  return (
    text.includes("transcript") ||
    text.includes("show transcript") ||
    ariaLabel.includes("transcript")
  )
}

const findButtonFromTouchFeedback = (
  feedback: HTMLElement,
  boundary: Element
): HTMLElement | null => {
  let current: HTMLElement | null = feedback.parentElement
  while (current && current !== boundary) {
    if (
      current.tagName === "BUTTON" ||
      current.classList.contains("yt-spec-button-shape-next")
    ) {
      return current
    }
    current = current.parentElement
  }
  return null
}

const findTranscriptButtonInSection = (): HTMLElement | null => {
  const section = document.querySelector<HTMLElement>(
    "ytd-video-description-transcript-section-renderer"
  )
  if (!section) return null
  logger.debug("Found transcript section renderer", "TranscriptExtractor")

  const direct = section.querySelector<HTMLElement>(
    "button.yt-spec-button-shape-next, ytd-button-renderer button, #primary-button button"
  )
  if (direct && isTranscriptButton(direct)) {
    logger.debug(
      "Found button inside transcript section",
      "TranscriptExtractor"
    )
    return direct
  }

  const feedback = section.querySelector<HTMLElement>(
    "div.yt-spec-touch-feedback-shape__fill"
  )
  if (!feedback) return null
  const button = findButtonFromTouchFeedback(feedback, section)
  if (button) {
    logger.debug(
      "Found button by traversing up from touch feedback",
      "TranscriptExtractor"
    )
  }
  return button
}

const findTranscriptButtonBySelectors = (): HTMLElement | null => {
  const selectors = [
    'button[aria-label*="transcript" i]',
    'button[aria-label*="Show transcript" i]',
    "ytd-button-renderer button",
    "button.yt-spec-button-shape-next"
  ]
  for (const selector of selectors) {
    const button = Array.from(
      document.querySelectorAll<HTMLElement>(selector)
    ).find(isTranscriptButton)
    if (!button) continue
    logger.debug(
      `Found button via selector: ${selector}`,
      "TranscriptExtractor"
    )
    return button
  }
  return null
}

const findTranscriptButtonByTouchFeedback = (): HTMLElement | null => {
  const feedbackDivs = Array.from(
    document.querySelectorAll<HTMLElement>(
      "div.yt-spec-touch-feedback-shape__fill"
    )
  )
  logger.debug(
    `Found ${feedbackDivs.length} touch feedback divs`,
    "TranscriptExtractor"
  )
  for (const feedback of feedbackDivs) {
    const section = feedback.closest(
      "ytd-video-description-transcript-section-renderer"
    )
    if (!section) continue
    const button = findButtonFromTouchFeedback(feedback, section)
    if (!button) continue
    logger.debug(
      "Found button by traversing touch feedback div",
      "TranscriptExtractor"
    )
    return button
  }
  return null
}

const findTranscriptButtonByText = (): HTMLElement | null => {
  const buttons = Array.from(
    document.querySelectorAll<HTMLElement>("button, div[role='button']")
  )
  logger.debug(
    `Found ${buttons.length} potential buttons for text search`,
    "TranscriptExtractor"
  )
  const button = buttons.find(isTranscriptButton) ?? null
  if (button)
    logger.debug("Found button via text search", "TranscriptExtractor")
  return button
}

const findTranscriptButton = (): HTMLElement | null =>
  findTranscriptButtonInSection() ||
  findTranscriptButtonBySelectors() ||
  findTranscriptButtonByTouchFeedback() ||
  findTranscriptButtonByText()

const expandYouTubeDescription = async (): Promise<void> => {
  logger.debug("Step 1: Looking for 'more' button...", "TranscriptExtractor")
  const moreButton = await waitForElement(
    "tp-yt-paper-button#expand.button.style-scope.ytd-text-inline-expander",
    3,
    300
  )
  if (!moreButton) {
    logger.debug(
      "'more' button not found (may already be expanded)",
      "TranscriptExtractor"
    )
    return
  }
  const text = moreButton.textContent?.trim() || ""
  logger.debug(
    `Found 'more' button with text: "${text}"`,
    "TranscriptExtractor"
  )
  if (!text.includes("more") && !text.includes("...")) {
    logger.debug(
      `'more' button found but text doesn't match: "${text}"`,
      "TranscriptExtractor"
    )
    return
  }
  logger.debug("Clicking 'more' button...", "TranscriptExtractor")
  moreButton.click()
  await new Promise((resolve) => setTimeout(resolve, 500))
  logger.debug("Waited 500ms for description to expand", "TranscriptExtractor")
}

const clickTranscriptButton = (button: HTMLElement): void => {
  button.click()
  button.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "mouse"
    })
  )
  button.dispatchEvent(
    new PointerEvent("pointerup", {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "mouse"
    })
  )
  button.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true, view: window })
  )
}

const transcriptPanelExists = (): boolean =>
  Boolean(document.querySelector(YOUTUBE_TRANSCRIPT_PANEL_SELECTOR))

const openTranscriptWithButton = async (
  button: HTMLElement
): Promise<boolean> => {
  logger.debug("Found transcript button!", "TranscriptExtractor", {
    buttonText: button.textContent?.trim() || "",
    ariaLabel: button.getAttribute("aria-label") || "",
    tag: button.tagName,
    classes: button.className
  })
  logger.debug("Clicking transcript button...", "TranscriptExtractor")
  clickTranscriptButton(button)
  await new Promise((resolve) => setTimeout(resolve, 1500))
  if (transcriptPanelExists()) {
    logger.debug("Transcript panel successfully opened!", "TranscriptExtractor")
    return true
  }
  logger.debug(
    "Transcript panel not found after clicking, waiting longer...",
    "TranscriptExtractor"
  )
  await new Promise((resolve) => setTimeout(resolve, 1500))
  const opened = transcriptPanelExists()
  if (opened) {
    logger.debug(
      "Transcript panel appeared after longer wait!",
      "TranscriptExtractor"
    )
  }
  return opened
}

const logTranscriptButtonSamples = (): void => {
  const buttonTexts = Array.from(
    document.querySelectorAll("button, div[role='button']")
  )
    .slice(0, 20)
    .map((button) => ({
      text: button.textContent?.trim(),
      ariaLabel: button.getAttribute("aria-label"),
      tag: button.tagName,
      classes: button.className
    }))
    .filter((info) => info.text || info.ariaLabel)
  logger.debug("Sample buttons found", "TranscriptExtractor", { buttonTexts })
}

const openYouTubeTranscript = async (): Promise<boolean> => {
  logger.debug("Starting transcript panel automation", "TranscriptExtractor")
  logger.debug(`Current URL: ${window.location.href}`, "TranscriptExtractor")
  if (!isYouTubeVideoPage(window.location.href)) {
    logger.debug("Not a YouTube video page, skipping", "TranscriptExtractor")
    return false
  }
  if (transcriptPanelExists()) {
    logger.debug("Transcript panel already exists!", "TranscriptExtractor")
    return true
  }

  await expandYouTubeDescription()
  logger.debug(
    "Step 2: Looking for 'Show transcript' button...",
    "TranscriptExtractor"
  )
  const maxRetries = 5
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    logger.debug(
      `Attempt ${attempt}/${maxRetries} to find transcript button...`,
      "TranscriptExtractor"
    )
    const button = findTranscriptButton()
    if (button && (await openTranscriptWithButton(button))) return true
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
  logTranscriptButtonSamples()
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

/** Reads the first `ytInitialPlayerResponse` object out of a script or document. */
const parsePlayerResponse = (source: string): YouTubePlayerResponse | null => {
  let searchFrom = 0
  while (true) {
    const markerIndex = source.indexOf("ytInitialPlayerResponse", searchFrom)
    if (markerIndex === -1) return null
    searchFrom = markerIndex + 1

    const jsonStart = source.indexOf("{", markerIndex)
    if (jsonStart === -1) return null

    const jsonText = extractBalancedJson(source, jsonStart)
    if (!jsonText) continue

    try {
      return JSON.parse(jsonText) as YouTubePlayerResponse
    } catch (error) {
      logger.debug(
        "Failed to parse ytInitialPlayerResponse",
        "TranscriptExtractor",
        { error }
      )
    }
  }
}

const getYouTubePlayerResponse = (): YouTubePlayerResponse | null => {
  for (const script of Array.from(document.querySelectorAll("script"))) {
    const parsed = parsePlayerResponse(script.textContent || "")
    if (parsed) return parsed
  }

  return null
}

/** The video the address bar currently points at, or "" off a video URL. */
const currentYouTubeVideoId = (): string => {
  return getYouTubeVideoId(window.location.href)
}

/**
 * Fetches the watch document for one video and reads its player response.
 *
 * Same-origin from a YouTube content script, so the request carries the user's
 * session exactly as the page's own would — which is what makes captions on
 * age-restricted and members-only videos resolve the same way they do in the
 * player.
 */
const fetchPlayerResponseForVideo = async (
  videoId: string
): Promise<YouTubePlayerResponse | null> => {
  try {
    const response = await fetch(
      `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
      { credentials: "same-origin" }
    )
    if (!response.ok) {
      logger.warn("YouTube watch page fetch failed", "TranscriptExtractor", {
        status: response.status,
        videoId
      })
      return null
    }
    return parsePlayerResponse(await response.text())
  } catch (error) {
    logger.warn("YouTube watch page fetch failed", "TranscriptExtractor", {
      error,
      videoId
    })
    return null
  }
}

/**
 * The player response for the video currently being watched.
 *
 * The inline `ytInitialPlayerResponse` script belongs to whichever video the
 * document first loaded. YouTube navigates without a reload, so after moving to
 * a second video that script still describes the first one — and its caption
 * `baseUrl` still points there, which is how a request about the open video can
 * be answered from a different video's transcript with no visible error.
 *
 * So the payload is trusted only when it *names* the video in the address bar.
 * A payload that names no video is not treated as current: unverifiable is not
 * the same as correct, and the stale case cannot be distinguished from the fresh
 * one without the id. Refetching costs one same-origin request in a case that
 * should not arise, which is the cheaper side to be wrong on.
 */
const resolveCurrentPlayerResponse =
  async (): Promise<YouTubePlayerResponse | null> => {
    const videoId = currentYouTubeVideoId()
    const inlineResponse = getYouTubePlayerResponse()
    const inlineVideoId = inlineResponse?.videoDetails?.videoId

    // With no id in the URL there is nothing to compare and nothing to refetch.
    if (!videoId) return inlineResponse
    if (inlineResponse && inlineVideoId === videoId) return inlineResponse

    logger.info(
      "Inline YouTube player response is not confirmed as the current video; refetching",
      "TranscriptExtractor",
      { inlineVideoId: inlineVideoId || null, videoId }
    )

    return (await fetchPlayerResponseForVideo(videoId)) ?? null
  }

/**
 * Whether this document was loaded for the video in the address bar.
 *
 * The staleness that makes the inline player response untrustworthy is exactly
 * what makes it useful here: it is part of the document, so if it still names the
 * video being watched, no navigation has happened since load and every mounted
 * element — the transcript panel included — was rendered for this video. If it
 * names a different video, or names none, the document has moved on and its
 * unlabelled DOM cannot be tied to anything.
 *
 * This needs no new selectors, which matters: YouTube's internal element and
 * attribute names change without notice, and a guess about them would be a second
 * source of silent wrongness rather than a check on the first.
 */
const documentBelongsToCurrentVideo = (): boolean => {
  const videoId = currentYouTubeVideoId()
  if (!videoId) return false
  return getYouTubePlayerResponse()?.videoDetails?.videoId === videoId
}

/**
 * Rejects a caption track belonging to another video.
 *
 * The track URL is what actually decides whose words arrive, so it is checked
 * directly rather than inferred from the payload that carried it. Reaching here
 * with a mismatch means the resolved player response disagreed with the address
 * bar, and fetching it anyway would return a different video's transcript.
 */
const captionTrackMatchesVideo = (
  track: YouTubeCaptionTrack,
  videoId: string
): boolean => {
  if (!videoId || !track.baseUrl) return true
  try {
    const trackVideoId = new URL(track.baseUrl).searchParams.get("v")
    return !trackVideoId || trackVideoId === videoId
  } catch {
    // An unparseable URL is not evidence of a mismatch; the fetch below will
    // fail on its own if it is genuinely broken.
    return true
  }
}

const getCaptionTrackLabel = (track: YouTubeCaptionTrack): string => {
  return (
    track.name?.simpleText ||
    track.name?.runs?.map((run) => run.text || "").join("") ||
    ""
  )
}

/** The browser UI language as a bare subtag ("de-AT" → "de"). */
const preferredCaptionLanguage = (): string =>
  (navigator.language || "").split("-")[0]?.toLowerCase() || ""

const selectCaptionTrack = (
  tracks: YouTubeCaptionTrack[]
): YouTubeCaptionTrack | null => {
  const usableTracks = tracks.filter((track) => track.baseUrl)
  if (usableTracks.length === 0) return null

  const inLanguage = (language: string, track: YouTubeCaptionTrack) =>
    Boolean(language) &&
    Boolean(track.languageCode?.toLowerCase().startsWith(language))

  // Author-written captions in the reader's own language first, then anything in
  // it: a German user asking about a video with German subtitles should not be
  // summarizing the English track. English keeps its old place as the fallback
  // for everyone else, ahead of automatic speech recognition of any language.
  const preferred = preferredCaptionLanguage()

  return (
    usableTracks.find(
      (track) => inLanguage(preferred, track) && track.kind !== "asr"
    ) ||
    usableTracks.find((track) => inLanguage(preferred, track)) ||
    usableTracks.find(
      (track) => inLanguage("en", track) && track.kind !== "asr"
    ) ||
    usableTracks.find((track) => inLanguage("en", track)) ||
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
      const timestampMs = (event as { tStartMs?: unknown }).tStartMs
      if (!Array.isArray(segs)) return ""
      const line = segs
        .map((seg) => (seg as { utf8?: unknown }).utf8)
        .filter((text): text is string => typeof text === "string")
        .join("")
      const timestamp =
        typeof timestampMs === "number"
          ? formatTranscriptTimestamp(timestampMs)
          : ""
      return withTranscriptTimestamp(timestamp, line)
    })
    .filter(Boolean)
    .join("\n")

  return transcript || null
}

const parseXmlTranscript = (payload: string): string | null => {
  const doc = new DOMParser().parseFromString(payload, "text/xml")
  const transcript = Array.from(doc.querySelectorAll("text"))
    .map((node) => {
      const startAttr = node.getAttribute("start")
      const seconds = startAttr !== null ? Number(startAttr) : null
      const timestamp =
        seconds !== null && Number.isFinite(seconds)
          ? formatTranscriptTimestamp(seconds * 1000)
          : ""
      return withTranscriptTimestamp(timestamp, node.textContent || "")
    })
    .filter(Boolean)
    .join("\n")

  return transcript || null
}

const fetchYouTubeCaptionTranscript = async (): Promise<string | null> => {
  const playerResponse = await resolveCurrentPlayerResponse()
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

  const videoId = currentYouTubeVideoId()
  if (!captionTrackMatchesVideo(selectedTrack, videoId)) {
    logger.warn(
      "Discarding a caption track that belongs to another video",
      "TranscriptExtractor",
      { videoId }
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
  const timestamp = normalizeTranscriptTimestamp(
    segment.querySelector<HTMLElement>(
      ".ytwTranscriptSegmentViewModelTimestamp, .timestamp, [aria-hidden='true']"
    )?.textContent
  )

  const modernText = segment.querySelector<HTMLElement>(
    '.ytAttributedStringHost[role="text"], span[role="text"]'
  )
  if (modernText?.textContent)
    return withTranscriptTimestamp(timestamp, modernText.textContent)

  const legacyText = segment.querySelector<HTMLElement>(
    ".cue, .segment-text, yt-formatted-string"
  )
  if (legacyText?.textContent)
    return withTranscriptTimestamp(timestamp, legacyText.textContent)

  const clone = segment.cloneNode(true) as Element
  clone
    .querySelectorAll(
      '[aria-hidden="true"], .ytwTranscriptSegmentViewModelTimestamp, .ytwTranscriptSegmentViewModelTimestampA11yLabel'
    )
    .forEach((node) => {
      node.remove()
    })

  return withTranscriptTimestamp(timestamp, clone.textContent || "")
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

export const extractYouTubeTranscript = async (): Promise<string | null> => {
  if (!isYouTubeVideoPage(window.location.href)) {
    logger.debug("Not a YouTube video page", "TranscriptExtractor")
    return null
  }

  logger.info("Starting YouTube transcript extraction", "TranscriptExtractor")

  // Captions first: the only source verified against the address bar, and the
  // only one that arrives whole rather than as however much of the panel
  // YouTube has rendered so far.
  const captionTranscript = await fetchYouTubeCaptionTranscript()
  if (captionTranscript) {
    logger.info(
      `Successfully extracted caption transcript (${captionTranscript.length} chars)`,
      "TranscriptExtractor"
    )
    return captionTranscript
  }

  // A panel that was already mounted when this ran is only trustworthy if the
  // document itself belongs to the video in the address bar. Reading it
  // otherwise is the original defect wearing a different hat: no id lives in
  // that DOM, so an unverifiable panel is indistinguishable from one a
  // navigation left behind.
  const mountedPanel = document.querySelector(YOUTUBE_TRANSCRIPT_PANEL_SELECTOR)
  if (mountedPanel) {
    if (!documentBelongsToCurrentVideo()) {
      logger.warn(
        "Ignoring a mounted transcript panel: this document belongs to another video",
        "TranscriptExtractor",
        { videoId: currentYouTubeVideoId() }
      )
      // Deliberately no transcript rather than possibly the wrong one. The
      // caller reports that none was found, which is true and checkable; a
      // previous video's transcript would be neither.
      return null
    }

    const existingPanelTranscript = extractYouTubePanelTranscript()
    if (existingPanelTranscript) {
      logger.info(
        `Falling back to the open panel transcript (${existingPanelTranscript.length} chars)`,
        "TranscriptExtractor"
      )
      return existingPanelTranscript
    }
  }

  // Nothing was mounted, so whatever the click renders is built by the live page
  // for the video it is currently showing — current by construction, with no id
  // check available or needed.
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
