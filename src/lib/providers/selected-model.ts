import { STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type { ProviderModel, SelectedModelRef } from "@/types"

export const isSelectedModelRef = (value: unknown): value is SelectedModelRef =>
  !!value &&
  typeof value === "object" &&
  typeof (value as SelectedModelRef).providerId === "string" &&
  typeof (value as SelectedModelRef).modelId === "string"

export const saveSelectedModelRef = async (
  ref: SelectedModelRef
): Promise<void> => {
  await Promise.all([
    plasmoGlobalStorage.set(STORAGE_KEYS.PROVIDER.SELECTED_MODEL_REF, ref),
    plasmoGlobalStorage.set(STORAGE_KEYS.PROVIDER.SELECTED_MODEL, ref.modelId),
    plasmoGlobalStorage.remove(STORAGE_KEYS.PROVIDER.SELECTION_CONFLICT_MODEL)
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
