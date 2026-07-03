import { STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type { ModelCapabilityOverride } from "./capabilities"

/**
 * Per-model capability overrides, persisted as a flat map keyed by
 * `${providerId}::${modelName}`. These let users declare capabilities a
 * provider cannot report on its own (vision, tool calling, etc.), so the
 * capability resolver can gate UI for those models. See `getModelCapabilities`
 * for how an override is layered on top of detection.
 */
export type ModelCapabilityOverrideMap = Record<string, ModelCapabilityOverride>

const STORAGE_KEY = STORAGE_KEYS.PROVIDER.MODEL_CAPABILITY_OVERRIDES

/**
 * Serializes read-modify-write operations on the override map. Each write reads
 * the whole map, patches one key, and writes it back; without serialization two
 * rapid writes (e.g. configuring model A then model B in quick succession) would
 * both read the same stale map and the second write would drop the first key's
 * change. Chaining writes here guarantees each one observes the previous result.
 *
 * Note: this guards writes within a single extension context only. A concurrent
 * write from another context (a second extension page, or Chrome-sync from
 * another device) can still race; that is an accepted limitation for this
 * low-frequency, user-driven setting.
 */
let writeQueue: Promise<unknown> = Promise.resolve()

const enqueueWrite = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = writeQueue.then(operation, operation)
  // Keep the chain alive regardless of whether an individual op rejects.
  writeQueue = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

export const modelCapabilityOverrideKey = (
  providerId: string,
  modelName: string
): string => `${providerId}::${modelName}`

export const getAllModelCapabilityOverrides =
  async (): Promise<ModelCapabilityOverrideMap> => {
    const stored =
      await plasmoGlobalStorage.get<ModelCapabilityOverrideMap>(STORAGE_KEY)
    return stored ?? {}
  }

export const getModelCapabilityOverride = async (
  providerId: string,
  modelName: string
): Promise<ModelCapabilityOverride | null> => {
  const all = await getAllModelCapabilityOverrides()
  return all[modelCapabilityOverrideKey(providerId, modelName)] ?? null
}

/**
 * Persist (or merge into) the override for a single model. Empty overrides are
 * removed so the map does not accumulate no-op entries. Serialized via
 * {@link enqueueWrite} so concurrent saves don't clobber each other.
 */
export const setModelCapabilityOverride = (
  providerId: string,
  modelName: string,
  override: ModelCapabilityOverride
): Promise<void> =>
  enqueueWrite(async () => {
    const all = await getAllModelCapabilityOverrides()
    const key = modelCapabilityOverrideKey(providerId, modelName)

    const cleaned = pruneEmptyOverride(override)
    if (cleaned) {
      all[key] = cleaned
    } else {
      delete all[key]
    }

    await plasmoGlobalStorage.set(STORAGE_KEY, all)
  })

export const clearModelCapabilityOverride = (
  providerId: string,
  modelName: string
): Promise<void> =>
  enqueueWrite(async () => {
    const all = await getAllModelCapabilityOverrides()
    const key = modelCapabilityOverrideKey(providerId, modelName)
    if (key in all) {
      delete all[key]
      await plasmoGlobalStorage.set(STORAGE_KEY, all)
    }
  })

/** Drop every override scoped to a provider (provider removed). */
export const clearModelCapabilityOverridesForProvider = (
  providerId: string
): Promise<void> =>
  enqueueWrite(async () => {
    const all = await getAllModelCapabilityOverrides()
    const prefix = `${providerId}::`
    let changed = false
    for (const key of Object.keys(all)) {
      if (key.startsWith(prefix)) {
        delete all[key]
        changed = true
      }
    }
    if (changed) await plasmoGlobalStorage.set(STORAGE_KEY, all)
  })

/** Drop undefined fields; return null if nothing meaningful remains. */
const pruneEmptyOverride = (
  override: ModelCapabilityOverride
): ModelCapabilityOverride | null => {
  const entries = Object.entries(override).filter(
    ([, value]) => value !== undefined
  )
  return entries.length > 0
    ? (Object.fromEntries(entries) as ModelCapabilityOverride)
    : null
}
