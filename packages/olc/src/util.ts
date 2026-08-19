/** Value coercion and retry helpers shared across the proxy. */
import type { RetryAsync } from "./types.js"

export const parseBool = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === "boolean") return value
  if (typeof value === "number") return value === 1
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    if (["1", "true", "yes", "y", "on"].includes(normalized)) return true
    if (["0", "false", "no", "n", "off"].includes(normalized)) return false
  }
  if (value === undefined || value === null) return fallback
  return Boolean(value)
}

/** Parse a list from an array or a comma/space separated string. */
export const parseList = (
  value: unknown,
  fallback: string[] = []
): string[] => {
  if (Array.isArray(value)) {
    return value.filter(
      (entry): entry is string =>
        typeof entry === "string" && entry.trim() !== ""
    )
  }
  if (typeof value === "string") {
    const entries = value
      .split(/[,\s]+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
    return entries.length > 0 ? entries : fallback
  }
  return fallback
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value)

export const isRetryableNetworkError = (error: unknown): boolean => {
  if (!error) return false
  const candidate = error as {
    message?: unknown
    code?: unknown
    cause?: { code?: unknown }
  }
  const message = String(candidate.message ?? error).toLowerCase()
  const code = candidate.code ?? candidate.cause?.code
  const retryableCodes = new Set([
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "EPIPE",
    "ENOTFOUND"
  ])
  if (typeof code === "string" && retryableCodes.has(code)) return true
  return (
    message.includes("socket hang up") ||
    message.includes("fetch failed") ||
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("network") ||
    message.includes("timeout")
  )
}

/**
 * Retry transport failures only.
 *
 * Why the distinction: a refused or reset connection says nothing happened yet,
 * so repeating it is safe. An error the OpenCode server produced is a real
 * answer, and repeating that request would duplicate whatever it already did.
 */
export const createRetryAsync = ({
  retries = 3,
  delayMs = 750,
  log = () => {}
}: {
  retries?: number
  delayMs?: number
  log?: (message: string) => void
} = {}): RetryAsync => {
  return async function retryAsync<T>(
    operation: () => Promise<T>,
    { label = "operation" }: { label?: string } = {}
  ): Promise<T> {
    let lastError: unknown
    for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
      try {
        return await operation()
      } catch (error) {
        lastError = error
        const isLastAttempt = attempt === retries + 1
        if (!isRetryableNetworkError(error) || isLastAttempt) throw error
        log(
          `[Proxy][Retry] ${label} failed (attempt ${attempt}/${retries + 1}): ${(error as Error).message}. Retrying in ${delayMs}ms...`
        )
        await sleep(delayMs)
      }
    }
    throw lastError
  }
}
