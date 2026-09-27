import { renderHook, waitFor } from "@testing-library/react"
import { useState } from "react"
import { expect, it, vi } from "vitest"
import {
  DEFAULT_EMBEDDING_CONFIG,
  DEFAULT_EMBEDDING_MODEL
} from "@/lib/constants"
import { SETTINGS } from "@/lib/storage/settings"
import { useEmbeddingSettingsState } from "../use-embedding-settings-state"

vi.mock("@/hooks/use-setting", () => ({
  useSetting: (descriptor: { key: string; defaultValue: unknown }) =>
    useState(
      descriptor.key === SETTINGS.EMBEDDING_SELECTED_MODEL.key
        ? "all-minilm"
        : descriptor.key === SETTINGS.EMBEDDING_CONFIG.key
          ? {
              ...DEFAULT_EMBEDDING_CONFIG,
              sharedEmbeddingProviderId: "ollama",
              sharedEmbeddingModel: "all-minilm"
            }
          : descriptor.defaultValue
    )
}))
vi.mock("../use-provider-models", () => ({
  useProviderModels: () => ({ models: [] })
}))
vi.mock("../use-native-embeddings", () => ({
  useNativeEmbeddings: () => ({ state: { mode: "external" } })
}))
vi.mock("@/protocol/extension-client", () => ({
  extensionRpcClient: { call: vi.fn(async () => ({ exists: true })) }
}))

it("normalizes aliases in both settings so availability settles", async () => {
  const { result } = renderHook(() => useEmbeddingSettingsState())
  await waitFor(() => expect(result.current.modelExists).toBe(true))
  expect(result.current.selectedModel).toBe(DEFAULT_EMBEDDING_MODEL)
  expect(result.current.config.sharedEmbeddingModel).toBe(
    DEFAULT_EMBEDDING_MODEL
  )
})
