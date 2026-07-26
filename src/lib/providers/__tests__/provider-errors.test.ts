import { afterEach, describe, expect, it, vi } from "vitest"

import { buildErrorReportUrl } from "@/lib/error-report"
import { isAppError } from "@/lib/error-utils"
import { OllamaProvider } from "../ollama"
import { OpenAICompatibleProvider } from "../openai-compatible"
import {
  isLocalProviderBaseUrl,
  parseRetryAfter,
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

  it("names the failing provider and keeps issue URLs out of message copy", () => {
    const msg = providerErrorUserMessage(500, {
      providerName: "llama.cpp",
      model: "gemma.gguf"
    })

    expect(msg).toContain(
      'llama.cpp returned HTTP 500 while generating a response with model "gemma.gguf"'
    )
    expect(msg).toContain("llama.cpp is running")
    expect(msg).toContain('model "gemma.gguf" is loaded')
    expect(msg).toContain("base URL/port")
    expect(msg).not.toContain("http")
    expect(msg).not.toContain("[open an issue]")

    const issueUrlValue = buildErrorReportUrl({
      status: 500,
      kind: "provider",
      message: msg,
      providerName: "llama.cpp",
      model: "gemma.gguf",
      baseUrl: "http://user:secret@localhost:8000/v1?token=private"
    })
    expect(issueUrlValue).toContain(
      "https://github.com/Shishir435/ollama-client/issues/new?"
    )
    const issueUrl = new URL(issueUrlValue)
    expect(issueUrl.searchParams.get("title")).toBe(
      "[bug] llama.cpp server error (500)"
    )
    expect(issueUrl.searchParams.get("body")).toContain("- Error status: 500")
    expect(issueUrl.searchParams.get("body")).toContain("- Provider: llama.cpp")
    expect(issueUrl.searchParams.get("body")).toContain("- Model: gemma.gguf")
    expect(issueUrl.searchParams.get("body")).toContain(
      "- Base URL: http://localhost:8000/v1"
    )
    expect(issueUrl.searchParams.get("body")).not.toContain("secret")
    expect(issueUrl.searchParams.get("body")).not.toContain("private")
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

  it("distinguishes hosted payment, overload, and retry timing", () => {
    expect(providerErrorUserMessage(402)).toContain("insufficient credits")
    expect(providerErrorUserMessage(529)).toContain("overloaded")
    expect(providerErrorUserMessage(429, { retryAfterMs: 42_000 })).toContain(
      "42 seconds"
    )
    expect(
      providerErrorUserMessage(503, {
        baseUrl: "https://openrouter.ai/api/v1",
        retryAfterMs: 2_000
      })
    ).toContain("hosted provider")
  })
})

describe("parseRetryAfter", () => {
  it("parses seconds and HTTP dates", () => {
    expect(parseRetryAfter("1.5")).toBe(1500)
    expect(parseRetryAfter("Thu, 01 Jan 2026 00:00:02 GMT", 0)).toBe(
      Date.parse("Thu, 01 Jan 2026 00:00:02 GMT")
    )
    expect(parseRetryAfter("invalid")).toBeUndefined()
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

describe("hosted provider retry metadata", () => {
  afterEach(() => vi.restoreAllMocks())

  it("preserves Retry-After and the custom provider id", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"error":"slow down"}', {
        status: 429,
        headers: { "Retry-After": "3" }
      })
    )
    const provider = new OpenAICompatibleProvider({
      id: "custom:openai:hosted",
      type: ProviderType.OPENAI,
      enabled: true,
      baseUrl: "https://api.example.com/v1",
      name: "Hosted"
    })

    try {
      await provider.streamChat({ model: "m", messages: [] }, () => {})
      throw new Error("Expected streamChat to fail")
    } catch (error) {
      expect(isAppError(error)).toBe(true)
      if (isAppError(error)) {
        expect(error.providerId).toBe("custom:openai:hosted")
        expect(error.retryable).toBe(true)
        expect(error.retryAfterMs).toBe(3000)
        expect(error.userMessage).toContain("3 seconds")
      }
    }
  })
})

describe("custom provider connection errors", () => {
  afterEach(() => vi.restoreAllMocks())

  it("identifies the saved provider, base URL, and selected model", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new TypeError("Failed to fetch")
    )
    const provider = new OpenAICompatibleProvider({
      id: "custom:openai:localai",
      type: ProviderType.OPENAI,
      enabled: true,
      baseUrl: "http://localhost:8080/v1",
      name: "My LocalAI"
    })

    try {
      await provider.streamChat({ model: "qwen3", messages: [] }, () => {})
      throw new Error("Expected streamChat to fail")
    } catch (error) {
      expect(isAppError(error)).toBe(true)
      if (isAppError(error)) {
        expect(error).toMatchObject({
          kind: "provider",
          status: 0,
          providerId: "custom:openai:localai",
          providerName: "My LocalAI",
          model: "qwen3",
          baseUrl: "http://localhost:8080/v1",
          retryable: true
        })
        expect(error.userMessage).toContain(
          'My LocalAI at http://localhost:8080/v1 could not be reached while requesting a response with model "qwen3"'
        )
        expect(error.userMessage).not.toContain("Failed to fetch")
      }
    }
  })
})

describe("provider-specific server errors", () => {
  afterEach(() => vi.restoreAllMocks())

  it("includes the configured provider and selected model", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"error":"template failure"}', { status: 500 })
    )
    const provider = new OpenAICompatibleProvider({
      id: "llamacpp",
      type: ProviderType.OPENAI,
      enabled: true,
      baseUrl: "http://localhost:8000/v1",
      name: "llama.cpp"
    })

    try {
      await provider.streamChat(
        { model: "gemma.gguf", messages: [{ role: "user", content: "hi" }] },
        () => {}
      )
      throw new Error("Expected streamChat to fail")
    } catch (error) {
      expect(isAppError(error)).toBe(true)
      if (isAppError(error)) {
        expect(error.userMessage).toContain(
          'llama.cpp at http://localhost:8000/v1 returned HTTP 500 while generating a response with model "gemma.gguf"'
        )
        expect(error.userMessage).toContain('model "gemma.gguf" is loaded')
        expect(error.userMessage).not.toContain("template failure")
      }
    }
  })
})
