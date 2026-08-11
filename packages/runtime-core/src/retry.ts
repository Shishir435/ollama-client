/** Parse an HTTP Retry-After value into a non-negative delay in milliseconds. */
export const parseRetryAfter = (
  value: string | null,
  now = Date.now()
): number | undefined => {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds)) {
    return seconds >= 0 ? Math.round(seconds * 1000) : undefined
  }

  const retryAt = Date.parse(value)
  if (Number.isNaN(retryAt)) return undefined
  return Math.max(0, retryAt - now)
}

/** HTTP statuses for which repeating an idempotent provider call can succeed. */
export const isRetryableProviderStatus = (status: number): boolean =>
  status === 408 || status === 429 || status === 529 || status >= 500
