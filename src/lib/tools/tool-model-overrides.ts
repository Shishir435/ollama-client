import { STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { TOOL_FAMILIES, type ToolFamily } from "./tool-families"
import { getToolFamilySettings, type ToolFamilySettings } from "./tool-settings"

/**
 * Per-model tool governance (0.11.18). An optional overlay on top of the global
 * {@link ToolFamilySettings}: a model with an entry uses its own values for the
 * fields it sets and falls back to the global setting for everything else. A
 * model with no entry is governed purely by the global settings, so this is a
 * no-op until a user opts a specific model in — no upgrade regression.
 *
 * Stored as a flat map keyed by `${providerId}::${modelName}`, mirroring
 * `model-capability-overrides.ts`.
 */
export interface ToolFamilyOverride {
  enabled?: boolean
  families?: Partial<Record<ToolFamily, boolean>>
}

export type ToolModelOverrideMap = Record<string, ToolFamilyOverride>

const STORAGE_KEY = STORAGE_KEYS.TOOLS.MODEL_OVERRIDES

export const toolModelOverrideKey = (
  providerId: string,
  modelName: string
): string => `${providerId}::${modelName}`

export const getAllToolModelOverrides =
  async (): Promise<ToolModelOverrideMap> => {
    const stored =
      await plasmoGlobalStorage.get<ToolModelOverrideMap>(STORAGE_KEY)
    return stored ?? {}
  }

export const getToolModelOverride = async (
  providerId: string,
  modelName: string
): Promise<ToolFamilyOverride | null> => {
  const all = await getAllToolModelOverrides()
  return all[toolModelOverrideKey(providerId, modelName)] ?? null
}

/**
 * Resolve the settings that actually gate a model: the global settings with any
 * per-model override layered on top. Each field falls back to global when the
 * override doesn't set it.
 */
export const getEffectiveToolFamilySettings = async (
  providerId: string,
  modelName: string
): Promise<ToolFamilySettings> => {
  const [global, override] = await Promise.all([
    getToolFamilySettings(),
    getToolModelOverride(providerId, modelName)
  ])
  if (!override) return global

  return {
    enabled: override.enabled ?? global.enabled,
    families: TOOL_FAMILIES.reduce(
      (acc, family) => {
        acc[family] = override.families?.[family] ?? global.families[family]
        return acc
      },
      {} as Record<ToolFamily, boolean>
    )
  }
}

/** Drop empty fields; return null when nothing meaningful remains. */
const pruneEmptyOverride = (
  override: ToolFamilyOverride
): ToolFamilyOverride | null => {
  const cleaned: ToolFamilyOverride = {}
  if (typeof override.enabled === "boolean") cleaned.enabled = override.enabled
  if (override.families) {
    const families = Object.fromEntries(
      Object.entries(override.families).filter(
        ([, value]) => typeof value === "boolean"
      )
    ) as Partial<Record<ToolFamily, boolean>>
    if (Object.keys(families).length > 0) cleaned.families = families
  }
  return cleaned.enabled !== undefined || cleaned.families ? cleaned : null
}

/**
 * Serialize read-modify-write operations so two rapid edits (model A then model
 * B) don't both read the same stale map and clobber each other. Same approach as
 * `model-capability-overrides.ts`; guards a single context only.
 */
let writeQueue: Promise<unknown> = Promise.resolve()

const enqueueWrite = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = writeQueue.then(operation, operation)
  writeQueue = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

/** Replace the override for one model (pruned; empty removes the entry). */
export const setToolModelOverride = (
  providerId: string,
  modelName: string,
  override: ToolFamilyOverride
): Promise<void> =>
  enqueueWrite(async () => {
    const all = await getAllToolModelOverrides()
    const key = toolModelOverrideKey(providerId, modelName)
    const cleaned = pruneEmptyOverride(override)
    if (cleaned) {
      all[key] = cleaned
    } else {
      delete all[key]
    }
    await plasmoGlobalStorage.set(STORAGE_KEY, all)
  })

export const clearToolModelOverride = (
  providerId: string,
  modelName: string
): Promise<void> =>
  enqueueWrite(async () => {
    const all = await getAllToolModelOverrides()
    const key = toolModelOverrideKey(providerId, modelName)
    if (key in all) {
      delete all[key]
      await plasmoGlobalStorage.set(STORAGE_KEY, all)
    }
  })
