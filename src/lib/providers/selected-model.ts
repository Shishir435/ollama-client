import { removeSetting, writeSetting } from "@/lib/storage/setting-access"
import { SelectedModelRefSchema } from "@/lib/storage/setting-schemas"
import { SETTINGS } from "@/lib/storage/settings"
import type { ProviderModel, SelectedModelRef } from "@/types"

export const isSelectedModelRef = (
  value: unknown
): value is SelectedModelRef => {
  const parsed = SelectedModelRefSchema.safeParse(value)
  return parsed.success && parsed.data !== null
}

export const saveSelectedModelRef = async (
  ref: SelectedModelRef
): Promise<void> => {
  await Promise.all([
    writeSetting(SETTINGS.SELECTED_MODEL_REF, ref),
    writeSetting(SETTINGS.SELECTED_MODEL, ref.modelId),
    removeSetting(SETTINGS.SELECTION_CONFLICT_MODEL)
  ])
}

export const resolveModelRefFromModels = (
  modelId: string,
  models: ProviderModel[]
): { ref: SelectedModelRef | null; ambiguous: boolean } => {
  const matches = models.filter((m) => m.name === modelId && m.providerId)

  if (matches.length === 1 && matches[0].providerId) {
    return {
      ref: {
        providerId: matches[0].providerId,
        modelId: matches[0].name
      },
      ambiguous: false
    }
  }

  return {
    ref: null,
    ambiguous: matches.length > 1
  }
}
