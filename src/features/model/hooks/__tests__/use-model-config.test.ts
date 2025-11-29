import { renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useModelConfig } from "../use-model-config"
import { DEFAULT_MODEL_CONFIG } from "@/lib/constants"

// Mock useStorage hook from @plasmohq/storage
vi.mock("@plasmohq/storage/hook", () => ({
  useStorage: vi.fn()
}))

describe("useModelConfig", () => {
  let mockSetModelConfigs: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockSetModelConfigs = vi.fn()
  })

  it("should return default config when no stored config exists", async () => {
    const { useStorage } = await import("@plasmohq/storage/hook")
    vi.mocked(useStorage).mockReturnValue([{}, mockSetModelConfigs])

    const { result } = renderHook(() => useModelConfig("llama3:latest"))

    const [config] = result.current

    expect(config).toEqual(DEFAULT_MODEL_CONFIG)
  })

  it("should merge stored config with defaults", async () => {
    const storedConfigs = {
      "llama3:latest": {
        temperature: 0.9,
        top_p: 0.95
      }
    }

    const { useStorage } = await import("@plasmohq/storage/hook")
    vi.mocked(useStorage).mockReturnValue([storedConfigs, mockSetModelConfigs])

    const { result } = renderHook(() => useModelConfig("llama3:latest"))

    const [config] = result.current

    expect(config.temperature).toBe(0.9)
    expect(config.top_p).toBe(0.95)
    // Should still have other defaults
    expect(config.top_k).toBe(DEFAULT_MODEL_CONFIG.top_k)
    expect(config.num_ctx).toBe(DEFAULT_MODEL_CONFIG.num_ctx)
  })

  it("should update config correctly", async () => {
    const { useStorage } = await import("@plasmohq/storage/hook")
    vi.mocked(useStorage).mockReturnValue([{}, mockSetModelConfigs])

    const { result } = renderHook(() => useModelConfig("llama3:latest"))

    const [, update] = result.current

    update({ temperature: 0.8 })

    expect(mockSetModelConfigs).toHaveBeenCalledWith(expect.any(Function))

    // Test the updater function
    const updaterFn = mockSetModelConfigs.mock.calls[0][0]
    const newConfigs = updaterFn({})

    expect(newConfigs["llama3:latest"]).toEqual({
      ...DEFAULT_MODEL_CONFIG,
      temperature: 0.8
    })
  })

  it("should preserve existing config when updating", async () => {
    const existingConfigs = {
      "llama3:latest": {
        temperature: 0.7,
        top_k: 50
      }
    }

    const { useStorage } = await import("@plasmohq/storage/hook")
    vi.mocked(useStorage).mockReturnValue([existingConfigs, mockSetModelConfigs])

    const { result } = renderHook(() => useModelConfig("llama3:latest"))

    const [, update] = result.current

    update({ top_p: 0.95 })

    const updaterFn = mockSetModelConfigs.mock.calls[0][0]
    const newConfigs = updaterFn(existingConfigs)

    expect(newConfigs["llama3:latest"].temperature).toBe(0.7)
    expect(newConfigs["llama3:latest"].top_k).toBe(50)
    expect(newConfigs["llama3:latest"].top_p).toBe(0.95)
  })

  it("should handle multiple model configs", async () => {
    const configs = {
      "llama3:latest": { temperature: 0.8 },
      "mistral:latest": { temperature: 0.6 }
    }

    const { useStorage } = await import("@plasmohq/storage/hook")
    vi.mocked(useStorage).mockReturnValue([configs, mockSetModelConfigs])

    const { result: result1 } = renderHook(() => useModelConfig("llama3:latest"))
    const { result: result2 } = renderHook(() => useModelConfig("mistral:latest"))

    expect(result1.current[0].temperature).toBe(0.8)
    expect(result2.current[0].temperature).toBe(0.6)
  })

  it("should handle undefined stored config", async () => {
    const { useStorage } = await import("@plasmohq/storage/hook")
    vi.mocked(useStorage).mockReturnValue([undefined, mockSetModelConfigs])

    const { result } = renderHook(() => useModelConfig("llama3:latest"))

    const [config] = result.current

    expect(config).toEqual(DEFAULT_MODEL_CONFIG)
  })

  it("should update partial config fields", async () => {
    const { useStorage } = await import("@plasmohq/storage/hook")
    vi.mocked(useStorage).mockReturnValue([{}, mockSetModelConfigs])

    const { result } = renderHook(() => useModelConfig("llama3:latest"))

    const [, update] = result.current

    // Update just temperature
    update({ temperature: 0.5 })

    const updaterFn = mockSetModelConfigs.mock.calls[0][0]
    const newConfigs = updaterFn({})

    expect(newConfigs["llama3:latest"].temperature).toBe(0.5)
    expect(newConfigs["llama3:latest"].top_k).toBe(DEFAULT_MODEL_CONFIG.top_k)
  })

  it("should handle system prompt updates", async () => {
    const { useStorage } = await import("@plasmohq/storage/hook")
    vi.mocked(useStorage).mockReturnValue([{}, mockSetModelConfigs])

    const { result } = renderHook(() => useModelConfig("llama3:latest"))

    const [, update] = result.current

    update({ system: "You are a code assistant" })

    const updaterFn = mockSetModelConfigs.mock.calls[0][0]
    const newConfigs = updaterFn({})

    expect(newConfigs["llama3:latest"].system).toBe("You are a code assistant")
  })
})
