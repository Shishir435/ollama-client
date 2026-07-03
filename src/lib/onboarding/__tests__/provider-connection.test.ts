import { afterEach, describe, expect, it, vi } from "vitest"

import { ProviderType } from "@/lib/providers/types"
import { checkProviderConnection } from "../provider-connection"

const config = {
  id: "ollama",
  type: ProviderType.OLLAMA,
  enabled: true,
  name: "Ollama",
  baseUrl: "http://localhost:11434"
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("checkProviderConnection", () => {
  it("reports a connected Ollama endpoint and model count", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ models: [{ name: "qwen" }] }), {
        status: 200
      })
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(checkProviderConnection(config)).resolves.toEqual({
      kind: "connected",
      modelCount: 1
    })
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:11434/api/tags",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it("classifies a local forbidden response as CORS", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 403 }))
    )

    await expect(checkProviderConnection(config)).resolves.toEqual({
      kind: "cors",
      status: 403
    })
  })

  it("keeps opaque network failures honest", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch")))

    await expect(checkProviderConnection(config)).resolves.toEqual({
      kind: "unavailable"
    })
  })

  it("sends x-api-key (not Bearer) for Anthropic", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "claude-sonnet" }] }), {
        status: 200
      })
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      checkProviderConnection({
        id: "custom:anthropic:abc",
        type: ProviderType.ANTHROPIC,
        enabled: true,
        name: "Anthropic",
        baseUrl: "https://api.anthropic.com/v1",
        apiKey: "sk-ant-test"
      })
    ).resolves.toEqual({ kind: "connected", modelCount: 1 })
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/models",
      expect.objectContaining({
        headers: {
          "x-api-key": "sk-ant-test",
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true"
        }
      })
    )
  })

  it("sends no auth header for Ollama even when an apiKey is set", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ models: [] }), { status: 200 })
      )
    vi.stubGlobal("fetch", fetchMock)

    // OllamaProvider never sends auth, so the onboarding check must not either —
    // otherwise it passes behind a proxy the real model requests would fail.
    await checkProviderConnection({ ...config, apiKey: "leak-me" })
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:11434/api/tags",
      expect.objectContaining({ headers: undefined })
    )
  })

  it("sends Bearer auth for OpenAI-compatible endpoints", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: [] }), { status: 200 })
      )
    vi.stubGlobal("fetch", fetchMock)

    await checkProviderConnection({
      id: "custom:openai:abc",
      type: ProviderType.OPENAI,
      enabled: true,
      name: "vLLM",
      baseUrl: "http://localhost:8000/v1",
      apiKey: "secret"
    })
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/v1/models",
      expect.objectContaining({
        headers: { Authorization: "Bearer secret" }
      })
    )
  })
})
