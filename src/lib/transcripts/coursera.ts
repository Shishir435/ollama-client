export const extractCourseraTranscript = (): string | null => {
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
