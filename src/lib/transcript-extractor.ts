import { logger } from "@/lib/logger"
import { extractCourseraTranscript } from "@/lib/transcripts/coursera"
import { extractUdemyTranscript } from "@/lib/transcripts/udemy"
import { extractYouTubeTranscript } from "@/lib/transcripts/youtube"

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
