/**
 * Single parse boundary for runtime-message payloads (v0.11.2 / F3).
 *
 * The message router previously narrowed payloads with scattered inline guards
 * and `as` casts. These typed parsers centralize that: each returns a validated,
 * normalized shape or `null`, so the router never casts and invalid payloads are
 * rejected in one place.
 */

/** A model reference: either a bare model name or `{ model, providerId? }`. */
export interface ModelRef {
  model: string
  providerId?: string
}

/**
 * Normalize a model-ref payload (`string` or `{ model, providerId? }`) to a
 * `ModelRef`, or `null` when the payload has no usable model name.
 */
export const parseModelRef = (payload: unknown): ModelRef | null => {
  if (typeof payload === "string") {
    const model = payload.trim()
    return model ? { model } : null
  }
  if (payload && typeof payload === "object" && "model" in payload) {
    const obj = payload as { model?: unknown; providerId?: unknown }
    if (typeof obj.model !== "string" || !obj.model.trim()) return null
    return {
      model: obj.model.trim(),
      providerId:
        typeof obj.providerId === "string" ? obj.providerId : undefined
    }
  }
  return null
}

/** A warmup ref: a {@link ModelRef} plus the previously-active model to unload. */
export interface WarmupRef extends ModelRef {
  previousModel?: string
  previousProviderId?: string
}

/**
 * Parse a WARMUP_MODEL payload, carrying through the `previous*` fields the
 * unload-on-switch path depends on (a plain `parseModelRef` would drop them).
 */
export const parseWarmupPayload = (payload: unknown): WarmupRef | null => {
  const ref = parseModelRef(payload)
  if (!ref) return null
  if (payload && typeof payload === "object") {
    const obj = payload as {
      previousModel?: unknown
      previousProviderId?: unknown
    }
    return {
      ...ref,
      previousModel:
        typeof obj.previousModel === "string" ? obj.previousModel : undefined,
      previousProviderId:
        typeof obj.previousProviderId === "string"
          ? obj.previousProviderId
          : undefined
    }
  }
  return ref
}

/** Extract a non-empty, trimmed string payload, or `null`. */
export const parseStringPayload = (payload: unknown): string | null => {
  if (typeof payload !== "string") return null
  const trimmed = payload.trim()
  return trimmed || null
}

/** Optional `{ providerId? }` payload (always returns an object). */
export const parseProviderIdPayload = (
  payload: unknown
): { providerId?: string } => {
  if (payload && typeof payload === "object" && "providerId" in payload) {
    const providerId = (payload as { providerId?: unknown }).providerId
    if (typeof providerId === "string") return { providerId }
  }
  return {}
}
