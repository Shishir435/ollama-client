import { beforeEach, describe, expect, it, vi } from "vitest"
import { STORAGE_KEYS } from "@/lib/constants"
import { getPlasmoStoredValue } from "@/lib/plasmo-global-storage"
import { getEmbeddingConfig, resetEmbeddingConfigCache } from "../config"

/**
 * The memo is process-wide, so every case starts from a clean one. Without
 * this the second case silently reads the first's value and passes only
 * because their expectations happen to agree.
 */
beforeEach(() => {
  resetEmbeddingConfigCache()
})

describe("getEmbeddingConfig", () => {
  it("normalizes legacy backend values", async () => {
    vi.mocked(getPlasmoStoredValue).mockResolvedValueOnce({
      annBackend: "wasm-hnsw",
      rerankerBackend: "transformers-js",
      useReranking: true
    } as unknown)

    const config = await getEmbeddingConfig()

    expect(config.annBackend).toBe("ts-hnsw")
    expect(config.rerankerBackend).toBe("cosine")
  })

  it("forces cosine when reranking is enabled", async () => {
    vi.mocked(getPlasmoStoredValue).mockResolvedValueOnce({
      rerankerBackend: "none",
      useReranking: true
    } as unknown)

    const config = await getEmbeddingConfig()

    expect(config.rerankerBackend).toBe("cosine")
  })
})

describe("getEmbeddingConfig caching", () => {
  it("reads storage once for repeated calls", async () => {
    vi.mocked(getPlasmoStoredValue).mockClear()
    vi.mocked(getPlasmoStoredValue).mockResolvedValue({
      chunkSize: 400
    } as unknown)

    const first = await getEmbeddingConfig()
    const second = await getEmbeddingConfig()

    expect(first.chunkSize).toBe(400)
    expect(second.chunkSize).toBe(400)
    expect(vi.mocked(getPlasmoStoredValue)).toHaveBeenCalledTimes(1)
  })

  it("collapses concurrent callers onto one read", async () => {
    vi.mocked(getPlasmoStoredValue).mockClear()
    vi.mocked(getPlasmoStoredValue).mockResolvedValue({
      chunkSize: 400
    } as unknown)

    await Promise.all([
      getEmbeddingConfig(),
      getEmbeddingConfig(),
      getEmbeddingConfig()
    ])

    expect(vi.mocked(getPlasmoStoredValue)).toHaveBeenCalledTimes(1)
  })

  /**
   * The watcher registers once per module instance, and the global test setup
   * clears mock call history between cases — so the registration call is only
   * observable from a freshly imported module.
   */
  const loadFreshConfigModule = async () => {
    vi.resetModules()
    const mod = await import("../config")
    vi.mocked(getPlasmoStoredValue).mockResolvedValueOnce({
      chunkSize: 400
    } as unknown)
    const first = await mod.getEmbeddingConfig()
    const listener = vi
      .mocked(globalThis.chrome.storage.onChanged.addListener)
      .mock.calls.at(-1)?.[0] as
      | ((changes: Record<string, unknown>) => void)
      | undefined
    return { mod, first, listener }
  }

  it("re-reads after the stored config changes", async () => {
    const { mod, first, listener } = await loadFreshConfigModule()
    expect(first.chunkSize).toBe(400)
    expect(listener).toBeTypeOf("function")

    listener?.({ [STORAGE_KEYS.EMBEDDINGS.CONFIG]: { newValue: {} } })

    vi.mocked(getPlasmoStoredValue).mockResolvedValueOnce({
      chunkSize: 900
    } as unknown)
    const after = await mod.getEmbeddingConfig()

    expect(after.chunkSize).toBe(900)
  })

  it("keeps the memo when an unrelated key changes", async () => {
    const { mod, listener } = await loadFreshConfigModule()

    listener?.({ "some-other-key": { newValue: 1 } })

    vi.mocked(getPlasmoStoredValue).mockClear()
    const after = await mod.getEmbeddingConfig()

    expect(after.chunkSize).toBe(400)
    expect(vi.mocked(getPlasmoStoredValue)).not.toHaveBeenCalled()
  })

  it("does not memoize a failed read", async () => {
    vi.mocked(getPlasmoStoredValue).mockRejectedValueOnce(
      new Error("storage unavailable")
    )
    await expect(getEmbeddingConfig()).rejects.toThrow("storage unavailable")

    vi.mocked(getPlasmoStoredValue).mockResolvedValueOnce({
      chunkSize: 400
    } as unknown)
    const recovered = await getEmbeddingConfig()

    expect(recovered.chunkSize).toBe(400)
  })
})
