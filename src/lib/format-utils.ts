import {
  MAX_REASONABLE_TOKENS_PER_SECOND,
  MIN_EVAL_DURATION_FOR_SPEED_NS
} from "@/lib/constants"

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
  if (!tokens || !duration || duration < MIN_EVAL_DURATION_FOR_SPEED_NS) {
    return "—"
  }

  const seconds = duration / 1_000_000_000
  const tokensPerSecond = tokens / seconds
  if (tokensPerSecond > MAX_REASONABLE_TOKENS_PER_SECOND) return "—"

  return `${Math.round(tokensPerSecond)} t/s`
}

/**
 * A provider-reported cost in US dollars. A single turn usually costs well
 * under a cent, so small amounts keep enough digits to be told apart.
 */
export const formatUsd = (amount: number): string => {
  if (amount >= 1) return `$${amount.toFixed(2)}`
  if (amount >= 0.01) return `$${amount.toFixed(3)}`
  return `$${amount.toPrecision(2)}`
}

/**
 * Filesystem-safe ISO-ish timestamp suffix (no colons or dots) for
 * download filenames. Same shape as `2026-05-21T13-42-08-321Z`.
 */
export const formatBackupFilenameTimestamp = (
  date: Date = new Date()
): string => date.toISOString().replace(/[:.]/g, "-")
