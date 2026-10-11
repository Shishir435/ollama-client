/** How long an optional catalog enrichment may hold up a catalog already in hand. */
export const OPTIONAL_METADATA_TIMEOUT_MS = 2_000

/**
 * Bounds a request whose answer is a nice-to-have. The caller's abort still
 * propagates; a server that accepts the request and stalls only costs the
 * deadline, after which the catalog goes back without the hint.
 */
export const readOptionalMetadata = async <T>(
  read: (signal: AbortSignal) => Promise<T>,
  fallback: T,
  signal?: AbortSignal
): Promise<T> => {
  const deadline = AbortSignal.timeout(OPTIONAL_METADATA_TIMEOUT_MS)
  try {
    return await read(signal ? AbortSignal.any([signal, deadline]) : deadline)
  } catch (error) {
    if (signal?.aborted) throw error
    return fallback
  }
}
