/**
 * How often an open surface re-asks providers for their model catalogs.
 *
 * The status indicator used to force a full refresh every 10 seconds, which
 * ignored the query cache and re-ran discovery against every enabled endpoint —
 * for a hosted router with hundreds of models, a real request against someone
 * else's rate limit six times a minute, plus the re-parse and re-render behind
 * it. A catalog changes when the user pulls or deletes a model, and both of
 * those already invalidate the query directly.
 */

/** Turns the poll off; the catalog then refreshes on open and on demand. */
export const CATALOG_REFRESH_OFF = 0

export const DEFAULT_CATALOG_REFRESH_MS = 60_000

/**
 * Never poll faster than this. The setting is sync-safe, so a value can arrive
 * from another device — and from an older build with a different idea of a
 * reasonable interval.
 *
 * Ten seconds is what the old hard-coded poll did, and it is offered again as a
 * deliberate choice rather than a default: chosen, it refetches one query per
 * provider, pauses while the surface is hidden, and stops when the panel
 * closes. The behavior that was removed forced a full cache invalidation on
 * every enabled provider whether or not anyone was looking.
 */
export const MIN_CATALOG_REFRESH_MS = 10_000

export const CATALOG_REFRESH_CHOICES_MS = [
  CATALOG_REFRESH_OFF,
  MIN_CATALOG_REFRESH_MS,
  20_000,
  30_000,
  60_000,
  120_000,
  300_000
] as const

const POLLING_CHOICES_MS = CATALOG_REFRESH_CHOICES_MS.filter(
  (choice) => choice > CATALOG_REFRESH_OFF
)

/**
 * Resolve a stored value to one of the offered choices.
 *
 * Snapping rather than clamping, because this is an enum wearing a number: the
 * select binds the same normalized value it polls on, so a stored 45s cannot
 * poll at one interval while the control claims another — or, worse, match no
 * option and render a blank trigger. Ties go to the slower choice; the point of
 * the setting is fewer requests.
 */
export const normalizeCatalogRefreshMs = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_CATALOG_REFRESH_MS
  }
  if (value <= CATALOG_REFRESH_OFF) return CATALOG_REFRESH_OFF
  // `<=` and an ascending list is what sends a tie to the slower choice.
  return POLLING_CHOICES_MS.reduce((best, choice) =>
    Math.abs(choice - value) <= Math.abs(best - value) ? choice : best
  )
}

/**
 * How long a fetched catalog stays fresh.
 *
 * The chosen interval *is* the answer to "how old is too old", so it governs
 * refetch-on-open too — otherwise someone who picked 10 seconds would open the
 * panel to a minute-old list and wait for the first tick to correct it. With
 * the poll off there is no chosen interval, so it falls back to the default
 * rather than re-asking every provider on every open.
 */
export const catalogStaleTimeMs = (refreshMs: number): number =>
  refreshMs > CATALOG_REFRESH_OFF ? refreshMs : DEFAULT_CATALOG_REFRESH_MS
