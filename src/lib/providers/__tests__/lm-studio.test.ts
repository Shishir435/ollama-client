import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { LMStudioProvider } from "../lm-studio"
import { ProviderId, ProviderType } from "../types"

/*
 * LMStudioProvider had no direct coverage, which is how it shipped
 * `max_context_length / 1024` in `details.parameter_size` — a token window
 * rendered as a model size in the model menu's parameter badge.
 */

const config = {
  id: ProviderId.LM_STUDIO,
  type: ProviderType.CUSTOM,
  name: "LM Studio",
  baseUrl: "http://localhost:1234/v1",
  enabled: true
}

const v0Response = (
  models: Array<Record<string, unknown>>
): Partial<Response> => ({
  ok: true,
  json: () => Promise.resolve({ data: models })
})

const makeProvider = () =>
  new LMStudioProvider(
    config as unknown as ConstructorParameters<typeof LMStudioProvider>[0]
  )

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("LMStudioProvider.getModels", () => {
  it("does not present the context window as a parameter count", async () => {
    vi.mocked(fetch).mockResolvedValue(
      v0Response([
        {
          id: "qwen3-8b",
          object: "model",
          type: "llm",
          publisher: "qwen",
          arch: "qwen3",
          quantization: "Q4_K_M",
          max_context_length: 8192
        }
      ]) as Response
    )

    const [model] = await makeProvider().getModels()

    // 8192 tokens would have rendered as "8K"; the id says 8B and that is the
    // only place a size can come from, since no LM Studio endpoint reports one.
    expect(model.details?.parameter_size).toBe("8B")
    expect(model.capabilityHints?.contextLength).toBe(8192)
  })

  it("forwards the reported capability tags", async () => {
    vi.mocked(fetch).mockResolvedValue(
      v0Response([
        {
          id: "google/gemma-4-12b",
          object: "model",
          type: "vlm",
          publisher: "google",
          arch: "gemma4",
          quantization: "Q4_K_M",
          max_context_length: 262144,
          capabilities: ["tool_use"]
        }
      ]) as Response
    )

    const [model] = await makeProvider().getModels()

    expect(model.capabilityHints?.capabilityTags).toEqual(["tool_use"])
    expect(model.details?.parameter_size).toBe("12B")
  })

  it("omits the tag hint when the server sends none", async () => {
    // Older LM Studio builds have no `capabilities` field, and an empty array is
    // a placeholder — neither is a reported "no tools".
    vi.mocked(fetch).mockResolvedValue(
      v0Response([
        {
          id: "old-build-7b",
          object: "model",
          type: "llm",
          publisher: "x",
          arch: "y"
        },
        {
          id: "empty-7b",
          object: "model",
          type: "llm",
          publisher: "x",
          arch: "y",
          capabilities: []
        }
      ]) as Response
    )

    const models = await makeProvider().getModels()

    expect(models[0].capabilityHints?.capabilityTags).toBeUndefined()
    expect(models[1].capabilityHints?.capabilityTags).toBeUndefined()
  })

  it("keeps the metadata the endpoint does report", async () => {
    vi.mocked(fetch).mockResolvedValue(
      v0Response([
        {
          id: "qwen3-8b",
          object: "model",
          type: "vlm",
          publisher: "qwen",
          arch: "qwen3",
          quantization: "Q4_K_M",
          max_context_length: 4096
        }
      ]) as Response
    )

    const [model] = await makeProvider().getModels()

    expect(model.name).toBe("qwen3-8b")
    expect(model.details?.quantization_level).toBe("Q4_K_M")
    expect(model.details?.family).toBe("qwen3")
    expect(model.details?.format).toBe("gguf")
    expect(model.capabilityHints?.modelType).toBe("vlm")
  })

  it("tolerates a model with no quantization or arch", async () => {
    vi.mocked(fetch).mockResolvedValue(
      v0Response([
        { id: "bare", object: "model", type: "llm", publisher: "x", arch: "" }
      ]) as Response
    )

    const [model] = await makeProvider().getModels()

    expect(model.details?.quantization_level).toBe("")
    expect(model.details?.family).toBe("lm-studio")
    expect(model.details?.parameter_size).toBe("")
    expect(model.capabilityHints?.contextLength).toBeUndefined()
  })

  it("queries /api/v0/models outside the /v1 base path", async () => {
    vi.mocked(fetch).mockResolvedValue(v0Response([]) as Response)

    await makeProvider().getModels()

    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      "http://localhost:1234/api/v0/models"
    )
  })
})

describe("LMStudioProvider.modelLifecycle", () => {
  it("normalizes the loaded-model endpoint inside the adapter", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: "qwen3-8b", arch: "qwen3", quantization: "Q4_K_M" }]
      })
    } as Response)

    await expect(
      makeProvider().modelLifecycle.listLoadedModels()
    ).resolves.toEqual([
      {
        name: "qwen3-8b",
        sizeBytes: 0,
        family: "qwen3",
        parameterSize: "",
        quantizationLevel: "Q4_K_M"
      }
    ])
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      "http://localhost:1234/api/v1/models"
    )
  })

  it("owns the LM Studio unload wire format", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response)

    await expect(
      makeProvider().modelLifecycle.unloadModel("qwen3-8b")
    ).resolves.toBe(true)
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "http://localhost:1234/api/v1/models/unload",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ model: "qwen3-8b" })
      })
    )
  })

  it("classifies lifecycle request failures inside the adapter", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Unavailable"
    } as Response)

    await expect(
      makeProvider().modelLifecycle.listLoadedModels()
    ).rejects.toMatchObject({
      status: 503,
      providerId: ProviderId.LM_STUDIO,
      retryable: true
    })
  })
})
