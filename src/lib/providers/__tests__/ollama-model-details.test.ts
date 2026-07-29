import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { clearOllamaDetailBackfillCache, OllamaProvider } from "../ollama"
import { ProviderId, ProviderType } from "../types"

/*
 * `/api/tags` reports empty family/parameter_size/quantization_level for
 * safetensors and MLX models: `gemma4:12b-mlx` came back blank next to
 * `gemma4:12b`'s "11.9B" / "Q4_K_M". `/api/show` has the data ("12.4B" /
 * "nvfp4"), so the two entries only differed by which endpoint answered.
 */

const config = {
  id: ProviderId.OLLAMA,
  type: ProviderType.OLLAMA,
  name: "Ollama",
  baseUrl: "http://localhost:11434",
  enabled: true
}

const makeProvider = () =>
  new OllamaProvider(
    config as unknown as ConstructorParameters<typeof OllamaProvider>[0]
  )

const tagsModel = (name: string, parameterSize: string) => ({
  name,
  model: name,
  modified_at: "",
  size: 0,
  digest: name,
  details: {
    parent_model: "",
    format: parameterSize ? "gguf" : "safetensors",
    family: parameterSize ? "gemma4" : "",
    families: [],
    parameter_size: parameterSize,
    quantization_level: parameterSize ? "Q4_K_M" : ""
  }
})

const jsonOk = (body: unknown) =>
  ({ ok: true, json: () => Promise.resolve(body) }) as Response

/** Routes /api/tags and /api/show off one fetch mock. */
const mockEndpoints = (
  models: unknown[],
  show: Record<string, unknown | Error>
) => {
  vi.mocked(fetch).mockImplementation((url, init) => {
    if (String(url).endsWith("/api/tags")) {
      return Promise.resolve(jsonOk({ models }))
    }
    const name = JSON.parse(String((init as RequestInit)?.body)).name
    const entry = show[name]
    if (entry instanceof Error) return Promise.reject(entry)
    if (!entry) return Promise.resolve({ ok: false, status: 404 } as Response)
    return Promise.resolve(jsonOk(entry))
  })
}

beforeEach(() => {
  // The backfill cache is module-level, so it must not carry a result from one
  // test into the next.
  clearOllamaDetailBackfillCache()
  vi.stubGlobal("fetch", vi.fn())
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("OllamaProvider.getModels metadata backfill", () => {
  it("fills in details /api/tags omitted for a non-GGUF model", async () => {
    mockEndpoints([tagsModel("gemma4:12b-mlx", "")], {
      "gemma4:12b-mlx": {
        details: {
          parent_model: "",
          format: "safetensors",
          family: "gemma4_unified",
          families: [],
          parameter_size: "12.4B",
          quantization_level: "nvfp4"
        }
      }
    })

    const [model] = await makeProvider().getModels()

    expect(model.details.parameter_size).toBe("12.4B")
    expect(model.details.quantization_level).toBe("nvfp4")
    expect(model.details.family).toBe("gemma4_unified")
  })

  it("does not call /api/show when every model already has metadata", async () => {
    mockEndpoints([tagsModel("gemma4:12b", "11.9B")], {})

    await makeProvider().getModels()

    const showCalls = vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).endsWith("/api/show"))
    expect(showCalls).toHaveLength(0)
  })

  it("asks only about the models that are missing metadata", async () => {
    mockEndpoints(
      [tagsModel("gemma4:12b", "11.9B"), tagsModel("gemma4:e2b-mlx", "")],
      {
        "gemma4:e2b-mlx": {
          details: {
            parent_model: "",
            format: "safetensors",
            family: "gemma4_unified",
            families: [],
            parameter_size: "2.6B",
            quantization_level: "nvfp4"
          }
        }
      }
    )

    const models = await makeProvider().getModels()

    const asked = vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).endsWith("/api/show"))
    expect(asked).toHaveLength(1)
    expect(models[0].details.parameter_size).toBe("11.9B")
    expect(models[1].details.parameter_size).toBe("2.6B")
  })

  it("keeps the blank entry when /api/show fails", async () => {
    // A blank badge beats a model list that throws.
    mockEndpoints([tagsModel("gemma4:12b-mlx", "")], {
      "gemma4:12b-mlx": new Error("connection reset")
    })

    const [model] = await makeProvider().getModels()

    expect(model.name).toBe("gemma4:12b-mlx")
    expect(model.details.parameter_size).toBe("")
  })

  it("propagates a cancelled backfill instead of returning a partial list", async () => {
    // Tolerating a failed /api/show must not tolerate cancellation: a caller
    // that aborted gets the abort, not a catalog missing whatever the backfill
    // had not finished reading.
    const controller = new AbortController()
    vi.mocked(fetch).mockImplementation((url) => {
      if (String(url).endsWith("/api/tags")) {
        return Promise.resolve(
          jsonOk({ models: [tagsModel("gemma4:12b-mlx", "")] })
        )
      }
      controller.abort()
      return Promise.reject(new DOMException("Aborted", "AbortError"))
    })

    await expect(
      makeProvider().getModels(controller.signal)
    ).rejects.toThrowError(/abort/i)
  })

  it("keeps the blank entry when /api/show also reports nothing", async () => {
    mockEndpoints([tagsModel("weird:1b", "")], {
      "weird:1b": { details: { parameter_size: "" } }
    })

    const [model] = await makeProvider().getModels()
    expect(model.details.parameter_size).toBe("")
  })

  it("asks once per model across repeated list calls", async () => {
    // getModels runs per turn for tool gating and again whenever the UI
    // refetches. Uncached, this issued an /api/show per affected model every
    // time — visibly so in the network panel.
    mockEndpoints([tagsModel("gemma4:12b-mlx", "")], {
      "gemma4:12b-mlx": {
        details: {
          parent_model: "",
          format: "safetensors",
          family: "gemma4_unified",
          families: [],
          parameter_size: "12.4B",
          quantization_level: "nvfp4"
        }
      }
    })
    const provider = makeProvider()

    await provider.getModels()
    const second = await provider.getModels()

    const showCalls = vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).endsWith("/api/show"))
    expect(showCalls).toHaveLength(1)
    // The second list is still enriched, from the cache.
    expect(second[0].details.parameter_size).toBe("12.4B")
  })

  it("asks again when the model file behind the name changes", async () => {
    const shown = (size: string) => ({
      details: {
        parent_model: "",
        format: "safetensors",
        family: "gemma4_unified",
        families: [],
        parameter_size: size,
        quantization_level: "nvfp4"
      }
    })
    const entry = tagsModel("gemma4:12b-mlx", "")
    mockEndpoints([entry], { "gemma4:12b-mlx": shown("12.4B") })
    const provider = makeProvider()
    await provider.getModels()

    // Same name, new digest — a re-pulled model must not answer from the old
    // entry, which is why the key includes the digest instead of a timer.
    const replaced = { ...entry, digest: "different-digest" }
    mockEndpoints([replaced], { "gemma4:12b-mlx": shown("9.9B") })
    const models = await provider.getModels()

    expect(models[0].details.parameter_size).toBe("9.9B")
  })

  it("caps the fan-out so a server reporting nothing cannot flood it", async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      tagsModel(`blank-${i}:1b`, "")
    )
    mockEndpoints(many, {})

    await makeProvider().getModels()

    const asked = vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).endsWith("/api/show"))
    expect(asked.length).toBeLessThanOrEqual(12)
    expect(asked.length).toBeGreaterThan(0)
  })
})
