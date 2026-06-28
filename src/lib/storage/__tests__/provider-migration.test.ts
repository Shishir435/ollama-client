import { describe, expect, it, vi } from "vitest"
import { LEGACY_STORAGE_KEYS, STORAGE_KEYS } from "@/lib/constants"
import { ProviderStorageKey } from "@/lib/providers/types"
import { migrateLegacyProviderStorage } from "@/lib/storage/provider-migration"

const createStorage = (initial: Record<string, unknown>) => {
  const values = new Map(Object.entries(initial))
  return {
    values,
    storage: {
      get: vi.fn(async (key: string) => values.get(key)),
      set: vi.fn(async (key: string, value: unknown) => {
        values.set(key, value)
      }),
      remove: vi.fn(async (key: string) => {
        values.delete(key)
      })
    }
  }
}

describe("0.10.3 provider storage upgrade", () => {
  it("migrates legacy provider values and creates a qualified model ref", async () => {
    const { storage, values } = createStorage({
      [LEGACY_STORAGE_KEYS.OLLAMA.BASE_URL]: "http://old-device:11434",
      [LEGACY_STORAGE_KEYS.OLLAMA.SELECTED_MODEL]: "qwen3",
      [LEGACY_STORAGE_KEYS.OLLAMA.PROMPT_TEMPLATES]: [{ name: "Legacy" }],
      [LEGACY_STORAGE_KEYS.OLLAMA.MODEL_CONFIGS]: {
        qwen3: { temperature: 0.2 }
      },
      [ProviderStorageKey.MODEL_MAPPINGS]: { qwen3: "ollama" },
      [STORAGE_KEYS.PROVIDER.SELECTION_CONFLICT_MODEL]: "qwen3"
    })

    const result = await migrateLegacyProviderStorage(storage as never)

    expect(result.migrated).toBe(true)
    expect(values.get(STORAGE_KEYS.PROVIDER.BASE_URL)).toBe(
      "http://old-device:11434"
    )
    expect(values.get(STORAGE_KEYS.PROVIDER.SELECTED_MODEL_REF)).toEqual({
      providerId: "ollama",
      modelId: "qwen3"
    })
    expect(values.has(STORAGE_KEYS.PROVIDER.SELECTION_CONFLICT_MODEL)).toBe(
      false
    )
  })

  it("never overwrites values already written by the new version", async () => {
    const { storage, values } = createStorage({
      [LEGACY_STORAGE_KEYS.OLLAMA.BASE_URL]: "http://legacy:11434",
      [STORAGE_KEYS.PROVIDER.BASE_URL]: "http://current:11434"
    })

    await migrateLegacyProviderStorage(storage as never)

    expect(values.get(STORAGE_KEYS.PROVIDER.BASE_URL)).toBe(
      "http://current:11434"
    )
  })

  it("is idempotent across service-worker restarts", async () => {
    const { storage } = createStorage({
      [LEGACY_STORAGE_KEYS.OLLAMA.SELECTED_MODEL]: "qwen3"
    })

    const first = await migrateLegacyProviderStorage(storage as never)
    const second = await migrateLegacyProviderStorage(storage as never)

    expect(first.migrated).toBe(true)
    expect(second.migrated).toBe(false)
  })
})
