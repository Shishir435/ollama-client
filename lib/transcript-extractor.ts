const extractYouTubeTranscript = (): string | null => {
  if (!window.location.href.includes("youtube.com/watch")) return null

  const transcriptContainer = document.querySelector("ytd-transcript-renderer")
  if (!transcriptContainer) return null

  const transcriptLines = transcriptContainer.querySelectorAll("div.cue-group")
  const fallbackLines = transcriptContainer.querySelectorAll(
    "yt-formatted-string"
  )
  const lines = transcriptLines.length > 0 ? transcriptLines : fallbackLines

  if (lines.length === 0) return null

  const transcript = Array.from(lines)
    .map((group) => {
      const cueText = group.querySelector?.(".cue")?.textContent?.trim()
      return cueText ?? group.textContent?.trim() ?? ""
    })
    .filter(Boolean)
    .join("\n")

  return transcript.length > 0 ? transcript : null
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
  const transcriptPanel = document.querySelector('div[role="tabpanel"]')
  if (!transcriptPanel) return null

  const cues = transcriptPanel.querySelectorAll('[data-purpose="cue-text"]')
  if (!cues || cues.length === 0) return null

  const transcript = Array.from(cues)
    .map((cue) => cue.textContent?.trim())
    .filter(Boolean)
    .join("\n")

  return transcript.length > 0 ? transcript : null
}

export const getTranscript = (): string | null => {
  return (
    extractYouTubeTranscript() ??
    extractUdemyTranscript() ??
    extractCourseraTranscript()
  )
}
