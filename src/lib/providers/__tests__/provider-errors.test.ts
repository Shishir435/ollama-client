import { afterEach, describe, expect, it, vi } from "vitest"

import { isAppError } from "@/lib/error-utils"
import { OllamaProvider } from "../ollama"
import {
  isLocalProviderBaseUrl,
  providerErrorUserMessage
} from "../provider-errors"
import { type ProviderConfig, ProviderType } from "../types"

describe("providerErrorUserMessage", () => {
  it("returns a clean, body-free message for each status class", () => {
    for (const status of [400, 401, 404, 408, 429, 500]) {
      const msg = providerErrorUserMessage(status)
      expect(msg.length).toBeGreaterThan(0)
      // Never leak raw JSON / response-body markers into the user message.
      expect(msg).not.toMatch(/[{}]/)
    }
  })

  it("explains the vision case on 400", () => {
    expect(providerErrorUserMessage(400).toLowerCase()).toContain("vision")
  })

  it("points local 401/403 responses at CORS setup instead of credentials", () => {
    const msg = providerErrorUserMessage(403, {
      baseUrl: "http://localhost:1234/v1"
    })

    expect(msg).toContain("CORS")
    expect(msg).toContain("provider's CORS or origin settings")
    expect(msg).not.toContain("OLLAMA_ORIGINS")
    expect(msg).not.toContain("Check the API key")
  })

  it("keeps credential guidance for remote 401/403 responses", () => {
    const msg = providerErrorUserMessage(401, {
      baseUrl: "https://api.example.com/v1"
    })

    expect(msg).toContain("credentials")
    expect(msg).not.toContain("OLLAMA_ORIGINS")
  })
})

describe("isLocalProviderBaseUrl", () => {
  it("detects local provider URLs", () => {
    expect(isLocalProviderBaseUrl("http://localhost:11434/v1")).toBe(true)
    expect(isLocalProviderBaseUrl("http://127.0.0.1:1234/v1")).toBe(true)
    expect(isLocalProviderBaseUrl("http://studio.localhost:1234/v1")).toBe(true)
    expect(isLocalProviderBaseUrl("https://api.example.com/v1")).toBe(false)
  })
})

describe("Ollama streamChat error", () => {
  afterEach(() => vi.restoreAllMocks())

  it("throws a clean userMessage and keeps the raw body in debug", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 400,
      text: async () =>
        '{"error":"json: cannot unmarshal object into ... api.ImageData"}'
    } as unknown as Response)

    const config: ProviderConfig = {
      id: "ollama",
      type: ProviderType.OLLAMA,
      enabled: true,
      baseUrl: "http://localhost:11434",
      name: "Ollama"
    }

    await expect(
      new OllamaProvider(config).streamChat(
        { model: "m", messages: [{ role: "user", content: "hi" }] },
        () => {}
      )
    ).rejects.toMatchObject({})

    try {
      await new OllamaProvider(config).streamChat(
        { model: "m", messages: [{ role: "user", content: "hi" }] },
        () => {}
      )
    } catch (err) {
      expect(isAppError(err)).toBe(true)
      if (isAppError(err)) {
        expect(err.userMessage).toBeTruthy()
        expect(err.userMessage).not.toMatch(/[{}]/)
        // Raw body retained for diagnostics only.
        expect(err.debug).toContain("unmarshal")
      }
    }
  })
})
