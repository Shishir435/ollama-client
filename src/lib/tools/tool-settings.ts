import { STORAGE_KEYS } from "@/lib/constants"
import {
  getPlasmoStoredValue,
  setPlasmoStoredValue
} from "@/lib/plasmo-global-storage"
import { TOOL_FAMILIES, type ToolFamily } from "./tool-families"

/**
 * User governance over model-callable tools (E10 — FEATURE_ROADMAP §3).
 *
 * `enabled` is the master switch ("let the model use tools at all"); `families`
 * toggles each risk class. Defaults are **all on** so upgrading users keep the
 * pre-0.11.14 behavior — the gate only ever *removes* tools the user turned off,
 * never adds capability silently.
 */
export interface ToolFamilySettings {
  enabled: boolean
  families: Record<ToolFamily, boolean>
}

const allFamilies = (value: boolean): Record<ToolFamily, boolean> =>
  TOOL_FAMILIES.reduce(
    (acc, family) => {
      acc[family] = value
      return acc
    },
    {} as Record<ToolFamily, boolean>
  )

export const DEFAULT_TOOL_FAMILY_SETTINGS: ToolFamilySettings = {
  enabled: true,
  families: allFamilies(true)
}

export const getToolFamilySettings = async (): Promise<ToolFamilySettings> => {
  const stored = await getPlasmoStoredValue<Partial<ToolFamilySettings>>(
    STORAGE_KEYS.TOOLS.FAMILIES
  )

  return {
    enabled: stored?.enabled ?? DEFAULT_TOOL_FAMILY_SETTINGS.enabled,
    families: {
      ...DEFAULT_TOOL_FAMILY_SETTINGS.families,
      ...(stored?.families ?? {})
    }
  }
}

/**
 * Serialize read-modify-write mutations. The UI can fire two toggles before the
 * first persist resolves; without this each handler reads the same stale
 * snapshot and the later write clobbers the earlier change. Chaining each
 * mutation onto the previous one makes get→set atomic relative to other writes.
 */
let writeLock: Promise<unknown> = Promise.resolve()

const mutateToolFamilySettings = (
  apply: (current: ToolFamilySettings) => ToolFamilySettings
): Promise<ToolFamilySettings> => {
  const run = writeLock.then(async () => {
    const current = await getToolFamilySettings()
    const next = apply(current)
    await setPlasmoStoredValue(STORAGE_KEYS.TOOLS.FAMILIES, next)
    return next
  })
  // Keep the chain alive even if one mutation rejects.
  writeLock = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

export const setToolMasterEnabled = (
  enabled: boolean
): Promise<ToolFamilySettings> =>
  mutateToolFamilySettings((current) => ({ ...current, enabled }))

export const setToolFamilyEnabled = (
  family: ToolFamily,
  enabled: boolean
): Promise<ToolFamilySettings> =>
  mutateToolFamilySettings((current) => ({
    ...current,
    families: { ...current.families, [family]: enabled }
  }))
