export const formatDuration = (nanoseconds?: number): string => {
  if (!nanoseconds) return "0ms"

  const milliseconds = nanoseconds / 1_000_000
  if (milliseconds < 1000) {
    return `${Math.round(milliseconds)}ms`
  }

  const seconds = milliseconds / 1000
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`
  }

  const minutes = seconds / 60
  return `${minutes.toFixed(1)}m`
}

export const formatTokensPerSecond = (
  tokens?: number,
  duration?: number
): string => {
  if (!tokens || !duration) return "0 t/s"

  const seconds = duration / 1_000_000_000
  const tokensPerSecond = tokens / seconds

  return `${Math.round(tokensPerSecond)} t/s`
}

/**
 * Filesystem-safe ISO-ish timestamp suffix (no colons or dots) for
 * download filenames. Same shape as `2026-05-21T13-42-08-321Z`.
 */
export const formatBackupFilenameTimestamp = (
  date: Date = new Date()
): string => date.toISOString().replace(/[:.]/g, "-")
