import { afterEach, describe, expect, it, vi } from "vitest"
import {
  buildErrorReportUrl,
  buildGenericIssueReportUrl,
  getSafeClientEnvironment
} from "@/lib/error-report"
import { isAppError, sanitizeModelIdentifier } from "@/lib/error-utils"
import { createAppError } from "@/lib/error-utils"
import { AnthropicProvider } from "../anthropic"
import { OllamaProvider } from "../ollama"
import { OpenAICompatibleProvider } from "../openai-compatible"
import {
  applyProviderErrorContext,
  classifyProviderError,
  isLocalProviderBaseUrl,
  isOllamaCloudModel,
  providerErrorUserMessage,
  providerFailureMessageKey
} from "../provider-errors"
import { type ProviderConfig, ProviderType } from "../types"

describe("providerErrorUserMessage", () => {
  afterEach(() => vi.unstubAllGlobals())

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

    expect(msg).toBe(
      "llama.cpp hit an internal error running gemma.gguf. Retry; if it repeats, check the server log."
    )
    expect(msg).not.toContain("HTTP 500")
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
    expect(issueUrl.searchParams.get("body")).toContain("- OS:")
    expect(issueUrl.searchParams.get("body")).toContain(
      "best effort; edit if incorrect"
    )
    expect(issueUrl.searchParams.get("body")).toContain("includes no telemetry")
    expect(issueUrl.searchParams.get("body")).toContain("or console logs")
    expect(issueUrl.searchParams.get("body")).toContain(
      "Optional support bundle (helps diagnose faster)"
    )
    expect(issueUrl.searchParams.get("body")).toContain(
      "Nothing is uploaded automatically"
    )
    expect(issueUrl.searchParams.get("body")).not.toContain("secret")
    expect(issueUrl.searchParams.get("body")).not.toContain("private")
  })

  it("detects Brave locally without requesting high-entropy browser data", () => {
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36",
      platform: "MacIntel",
      brave: {}
    })

    expect(getSafeClientEnvironment()).toEqual({
      browser: "Brave (Chromium 140)",
      os: "macOS"
    })
  })

  it("prefills generic reports with safe current environment and selection", () => {
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36",
      platform: "MacIntel",
      brave: {}
    })

    const issueUrl = new URL(
      buildGenericIssueReportUrl({
        providerId: "ollama",
        model: "/Users/alice/Models/qwen.gguf"
      })
    )
    const body = issueUrl.searchParams.get("body")

    expect(issueUrl.searchParams.get("title")).toBe("[bug] Help needed: ")
    expect(body).toContain("- Extension version:")
    expect(body).not.toContain("Extension version: 0.12.3")
    expect(body).toContain(
      "- Browser: Brave (Chromium 150) (best effort; edit if incorrect)"
    )
    expect(body).toContain("- OS: macOS (coarse family only)")
    expect(body).toContain("- Selected provider: ollama")
    expect(body).toContain(
      "- Selected model: /Users/<redacted>/Models/qwen.gguf"
    )
    expect(body).toContain("Preview support bundle")
    expect(body).toContain("up to seven days")
    expect(body).toContain("includes no telemetry")
  })

  it("points local 401/403 responses at CORS setup instead of credentials", () => {
    const msg = providerErrorUserMessage(403, {
      baseUrl: "http://localhost:1234/v1"
    })

    expect(msg).toContain("blocked this extension")
    expect(msg).toContain("CORS settings")
    expect(msg).not.toContain("OLLAMA_ORIGINS")
    expect(msg).not.toContain("API key")
  })

  it("keeps credential guidance for remote 401/403 responses", () => {
    const msg = providerErrorUserMessage(401, {
      baseUrl: "https://api.example.com/v1"
    })

    expect(msg).toBe(
      "The provider rejected the API key. Check it in provider settings."
    )
    expect(msg).not.toContain("OLLAMA_ORIGINS")
  })

  it("tells a remote Ollama to allow the extension origin, not check a key", () => {
    const msg = providerErrorUserMessage(403, {
      baseUrl: "https://ollama.example.com",
      providerName: "Ollama",
      ollama: true
    })

    expect(msg).toBe(
      "Ollama refused this extension's requests. Allow it by setting OLLAMA_ORIGINS=chrome-extension://*,moz-extension://* on the server."
    )
  })

  it("distinguishes hosted payment, overload, and retry timing", () => {
    expect(providerErrorUserMessage(402)).toContain("needs payment or credits")
    expect(providerErrorUserMessage(529)).toContain("overloaded")
    expect(providerErrorUserMessage(429, { retryAfterMs: 42_000 })).toContain(
      "42 seconds"
    )
    expect(
      providerErrorUserMessage(503, {
        baseUrl: "https://openrouter.ai/api/v1",
        retryAfterMs: 2_000
      })
    ).toContain("temporarily unavailable")
  })

  it("classifies safe provider reasons without returning raw text", () => {
    expect(
      classifyProviderError(
        500,
        "CUDA out of memory while loading /Users/alice/private/model.gguf"
      )
    ).toEqual({
      code: "OLC-OUT-OF-MEMORY",
      reason:
        "The model needs more memory than this machine has free. Close other apps or pick a smaller model.",
      recoveryAction: "choose-model"
    })
  })

  it("recognizes Ollama's memory and runner-crash 500 bodies", () => {
    expect(
      classifyProviderError(
        500,
        '{"error":"model requires more system memory (12.3 GiB) than is available (4.1 GiB)"}'
      ).code
    ).toBe("OLC-OUT-OF-MEMORY")
    expect(
      classifyProviderError(
        500,
        '{"error":"llama runner process has terminated: exit status 2"}'
      )
    ).toEqual({
      code: "OLC-PROVIDER-HTTP",
      reason:
        "The model crashed while loading. Retry; if it repeats, check the provider's log.",
      recoveryAction: "retry",
      messageKey: "chat.errors.model_crashed"
    })
  })

  it("names a free-tier refusal instead of blaming the proxy", () => {
    const refusal =
      "Error from provider (Console): OpenCode's free tier can only be used from within OpenCode"
    for (const status of [403, 502, undefined]) {
      expect(classifyProviderError(status, refusal)).toEqual({
        code: "OLC-FREE-TIER-REFUSED",
        reason:
          "OpenCode's free tier refused this request from a third-party client. Use a model from a key-backed provider, or run this model in OpenCode's own app.",
        recoveryAction: "choose-model"
      })
    }
    expect(classifyProviderError(403, "forbidden")).toEqual({
      code: "OLC-AUTH-FAILED",
      recoveryAction: "test-connection"
    })
  })

  it("redacts usernames from path-shaped model IDs", () => {
    expect(
      sanitizeModelIdentifier(
        "/Users/mr.ak/Desktop/private/DeepSeek-R1-Qwen3-8B.gguf"
      )
    ).toBe("/Users/<redacted>/Desktop/private/DeepSeek-R1-Qwen3-8B.gguf")
    expect(sanitizeModelIdentifier("C:\\Users\\Alice\\Models\\qwen.gguf")).toBe(
      "C:\\Users\\<redacted>\\Models\\qwen.gguf"
    )
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
      headers: new Headers(),
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

const ollamaConfig: ProviderConfig = {
  id: "ollama",
  type: ProviderType.OLLAMA,
  enabled: true,
  baseUrl: "http://localhost:11434",
  name: "Ollama"
}

const ndjson = (...lines: string[]) =>
  new Response(lines.map((line) => `${line}\n`).join(""), {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson" }
  })

const caught = async (run: () => Promise<unknown>) => {
  try {
    await run()
  } catch (error) {
    return error
  }
  throw new Error("expected a rejection")
}

describe("Ollama image generation models", () => {
  afterEach(() => vi.restoreAllMocks())

  /** Ollama's exact refusal: `server/routes.go`, HTTP 400. */
  const REFUSAL =
    '{"error":"image generation models are not currently supported"}'

  it("reads olc's Codex 400s as image generation not offered", () => {
    /** `packages/olc/src/backends/codex/index.ts` resolveModel errors. */
    for (const message of [
      "The active Codex model provider does not support image generation",
      "Codex returned no model that can drive image generation"
    ]) {
      expect(
        classifyProviderError(400, JSON.stringify({ error: { message } }))
          .messageKey
      ).toBe("chat.errors.image_generation_not_offered")
    }
  })

  it("names the cause instead of the generic 400 copy", () => {
    expect(classifyProviderError(400, REFUSAL)).toEqual({
      code: "OLC-INPUT-UNSUPPORTED",
      reason:
        "This Ollama version can't generate images. Choose a chat model, or use an Ollama version that supports image models.",
      recoveryAction: "choose-model",
      messageKey: "chat.errors.image_generation_unsupported"
    })
    expect(
      classifyProviderError(400, "Image generation model is not supported")
        .messageKey
    ).toBe("chat.errors.image_generation_unsupported")
  })

  it("keeps the specific copy through chat and the background boundary", async () => {
    for (const run of [
      (provider: OllamaProvider) =>
        provider.streamChat(
          {
            model: "x/z-image-turbo",
            messages: [{ role: "user", content: "a cat" }]
          },
          () => {}
        ),
      (provider: OllamaProvider) =>
        provider.generateImage(
          { model: "x/z-image-turbo", prompt: "a cat" },
          () => {}
        )
    ]) {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(REFUSAL, { status: 400 })
      )
      const error = await caught(() => run(new OllamaProvider(ollamaConfig)))
      expect(isAppError(error)).toBe(true)
      if (!isAppError(error)) return
      expect(error.messageKey).toBe("chat.errors.image_generation_unsupported")
      expect(error.userMessage).toContain("can't generate images")
      applyProviderErrorContext(error, {
        providerId: "ollama",
        providerName: "Ollama",
        model: "x/z-image-turbo",
        baseUrl: "http://localhost:11434"
      })
      expect(error.messageKey).toBe("chat.errors.image_generation_unsupported")
      expect(error.userMessage).toContain("can't generate images")
      expect(error.userMessage).not.toContain(
        "images on a model without vision"
      )
    }
  })
})

describe("Ollama mid-stream error lines", () => {
  afterEach(() => vi.restoreAllMocks())

  it("fails an image generation stream that reports an error", async () => {
    /**
     * A 200 already went out; the runner then died. Dropping the line ended
     * the stream as "returned no generated image" and hid the cause.
     */
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      ndjson(
        '{"model":"x/flux2-klein","created_at":"2026-10-16T08:00:00Z","completed":1,"total":4,"done":false}',
        '{"error":"llama runner process has terminated: signal: killed"}'
      )
    )
    const error = await caught(() =>
      new OllamaProvider(ollamaConfig).generateImage(
        { model: "x/flux2-klein", prompt: "a cat" },
        () => {}
      )
    )
    expect(isAppError(error)).toBe(true)
    if (!isAppError(error)) return
    expect(error.phase).toBe("read-stream")
    expect(error.messageKey).toBe("chat.errors.model_crashed")
    expect(error.debug).toContain("runner process has terminated")
  })

  it("classifies an out-of-memory line after chat content started", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      ndjson(
        '{"model":"qwen3:0.6b","message":{"role":"assistant","content":"Hel"},"done":false}',
        '{"error":"model requires more system memory (12.3 GiB) than is available (4.1 GiB)"}'
      )
    )
    const chunks: string[] = []
    const error = await caught(() =>
      new OllamaProvider(ollamaConfig).streamChat(
        { model: "qwen3:0.6b", messages: [{ role: "user", content: "hi" }] },
        (chunk) => {
          if (chunk.delta) chunks.push(chunk.delta)
        }
      )
    )
    expect(chunks).toEqual(["Hel"])
    expect(isAppError(error)).toBe(true)
    if (!isAppError(error)) return
    expect(error.code).toBe("OLC-OUT-OF-MEMORY")
    applyProviderErrorContext(error, {
      providerId: "ollama",
      providerName: "Ollama",
      model: "qwen3:0.6b"
    })
    expect(error.messageKey).toBe("chat.errors.out_of_memory")
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
        expect(error.userMessage).toBe(
          "Can't reach My LocalAI at http://localhost:8080/v1. Start it, then retry. If it's running, check the base URL."
        )
        expect(error.messageKey).toBe("chat.errors.provider_unreachable")
        expect(error.userMessage).not.toContain("Failed to fetch")
      }
    }
  })

  it("keeps provider context when an HTTP-200 stream disconnects", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new TypeError("socket closed"))
      }
    })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(stream, { status: 200 })
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
          code: "OLC-STREAM-DROPPED",
          phase: "read-stream",
          recoveryAction: "retry"
        })
        expect(error.userMessage).toBe(
          "The connection to My LocalAI dropped mid-answer. Retry to get a fresh response."
        )
        expect(error.userMessage).not.toContain("socket closed")
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
        expect(error.userMessage).toBe(
          "llama.cpp hit an internal error running gemma.gguf. Retry; if it repeats, check the server log."
        )
        expect(error.messageKey).toBe("chat.errors.provider_server_error")
        expect(error.userMessage).not.toContain("template failure")
      }
    }
  })

  it("surfaces a classified safe reason but not raw provider detail", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(
          '{"error":"CUDA out of memory loading /Users/alice/private.gguf"}',
          { status: 500 }
        )
    )
    const provider = new OpenAICompatibleProvider({
      id: "custom:localai",
      type: ProviderType.OPENAI,
      enabled: true,
      baseUrl: "http://localhost:8080/v1",
      name: "LocalAI"
    })

    await expect(
      provider.streamChat(
        { model: "large.gguf", messages: [{ role: "user", content: "hi" }] },
        () => {}
      )
    ).rejects.toMatchObject({
      code: "OLC-OUT-OF-MEMORY",
      recoveryAction: "choose-model",
      userMessage: expect.stringContaining(
        "The model needs more memory than this machine has free."
      )
    })

    try {
      await provider.streamChat(
        { model: "large.gguf", messages: [{ role: "user", content: "hi" }] },
        () => {}
      )
    } catch (error) {
      expect(isAppError(error)).toBe(true)
      if (isAppError(error)) {
        expect(error.userMessage).not.toContain("/Users/alice")
      }
    }
  })
})

describe("wedged local provider (503)", () => {
  afterEach(() => vi.restoreAllMocks())

  const WEDGED_BODY = JSON.stringify({
    error: {
      message:
        'The previous request ("chat-completions:req_01H") has not stopped since it was cancelled, so this one cannot start without overlapping it. The runtime may need a restart.',
      type: "ServiceUnavailable"
    }
  })

  it("separates a busy local endpoint from an unreachable one", () => {
    expect(
      classifyProviderError(503, WEDGED_BODY, "http://127.0.0.1:8084/v1")
    ).toEqual({
      code: "OLC-PROVIDER-BUSY",
      reason:
        "The local endpoint is still finishing an earlier request and cannot start another.",
      recoveryAction: "wait-retry"
    })
  })

  it("leaves every other local server error on the existing advice", () => {
    expect(
      classifyProviderError(500, "internal error", "http://127.0.0.1:8084/v1")
    ).toEqual({
      code: "OLC-PROVIDER-HTTP",
      recoveryAction: "retry"
    })
    expect(
      classifyProviderError(502, "bad gateway", "http://localhost:8084/v1")
    ).toEqual({
      code: "OLC-PROVIDER-HTTP",
      recoveryAction: "retry"
    })
  })

  it("keeps a hosted 503 as genuine overload", () => {
    expect(
      classifyProviderError(503, "upstream busy", "https://api.example.com/v1")
    ).toEqual({
      code: "OLC-PROVIDER-HTTP",
      recoveryAction: "retry"
    })
    expect(
      providerErrorUserMessage(503, { baseUrl: "https://api.example.com/v1" })
    ).toContain("temporarily unavailable")
  })

  it("tells the user to wait or restart, without quoting the provider", () => {
    const msg = providerErrorUserMessage(503, {
      baseUrl: "http://127.0.0.1:8084/v1",
      providerName: "OpenCode"
    })

    expect(msg).toContain("still finishing an earlier request")
    expect(msg).toContain("Wait about a minute, or restart it.")
    expect(msg).not.toContain("chat-completions:req_")
    expect(msg).not.toContain("overlapping")
    expect(msg).not.toMatch(/[{}]/)
  })

  it("carries a localized key and keeps the raw body in debug only", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(WEDGED_BODY, { status: 503 })
    )
    const provider = new OpenAICompatibleProvider({
      id: "custom:openai:olc",
      type: ProviderType.OPENAI,
      enabled: true,
      baseUrl: "http://127.0.0.1:8084/v1",
      name: "OpenCode"
    })

    try {
      await provider.streamChat({ model: "m", messages: [] }, () => {})
      throw new Error("Expected streamChat to fail")
    } catch (error) {
      expect(isAppError(error)).toBe(true)
      if (isAppError(error)) {
        expect(error.code).toBe("OLC-PROVIDER-BUSY")
        expect(error.recoveryAction).toBe("wait-retry")
        expect(error.messageKey).toBe("chat.errors.provider_busy")
        expect(error.userMessage).not.toContain("chat-completions:req_")
        expect(error.debug).toContain("chat-completions:req_")
      }
    }
  })
})

describe("provider failure message keys", () => {
  it("names each classified failure with its own key", () => {
    expect(providerFailureMessageKey({ code: "OLC-AUTH-FAILED" })).toBe(
      "chat.errors.provider_auth"
    )
    expect(providerFailureMessageKey({ code: "OLC-PAYMENT-REQUIRED" })).toBe(
      "chat.errors.payment_required"
    )
    expect(
      providerFailureMessageKey({ code: "OLC-CONTEXT-TOO-LARGE", status: 400 })
    ).toBe("chat.errors.context_too_long")
    expect(providerFailureMessageKey({ code: "OLC-MODEL-NOT-FOUND" })).toBe(
      "chat.errors.model_not_found"
    )
    expect(
      providerFailureMessageKey({
        code: "OLC-PROVIDER-HTTP",
        status: 500,
        baseUrl: "http://localhost:11434"
      })
    ).toBe("chat.errors.provider_server_error")
    expect(
      providerFailureMessageKey({ code: "OLC-PROVIDER-UNREACHABLE", status: 0 })
    ).toBe("chat.errors.provider_unreachable")
  })

  it("mentions OLLAMA_ORIGINS only for Ollama", () => {
    expect(
      providerFailureMessageKey({
        code: "OLC-CORS-BLOCKED",
        providerId: "ollama",
        baseUrl: "http://localhost:11434"
      })
    ).toBe("chat.errors.provider_cors")
    expect(
      providerFailureMessageKey({
        code: "OLC-CORS-BLOCKED",
        providerId: "ollama",
        baseUrl: "https://ollama.example.com"
      })
    ).toBe("chat.errors.provider_cors_remote")
    expect(
      providerFailureMessageKey({
        code: "OLC-CORS-BLOCKED",
        providerId: "lmstudio",
        baseUrl: "http://localhost:1234/v1"
      })
    ).toBe("chat.errors.provider_cors_other")
  })
})

describe("Ollama cloud models", () => {
  it("recognizes :cloud and -cloud tags only", () => {
    expect(isOllamaCloudModel("glm-5.3:cloud")).toBe(true)
    expect(isOllamaCloudModel("gpt-oss:120b-cloud")).toBe(true)
    expect(isOllamaCloudModel("llama3.2:latest")).toBe(false)
    expect(isOllamaCloudModel("cloud-model")).toBe(false)
    expect(isOllamaCloudModel(undefined)).toBe(false)
  })

  it("names both start and signin when a cloud model cannot be reached (#420)", () => {
    const error = applyProviderErrorContext(
      createAppError("Ollama connection failed: Failed to fetch", {
        kind: "provider",
        status: 0,
        providerId: "ollama",
        code: "OLC-PROVIDER-UNREACHABLE"
      }),
      {
        providerId: "ollama",
        providerName: "Ollama",
        model: "glm-5.3:cloud",
        baseUrl: "http://localhost:11434"
      }
    )

    expect(error.messageKey).toBe("chat.errors.ollama_cloud_unreachable")
    expect(error.userMessage).toBe(
      "Can't reach Ollama for glm-5.3:cloud. Start Ollama. If it's already running, this cloud model needs `ollama signin`."
    )
  })

  it("keeps the origin fix for a 403 on a cloud model", () => {
    const error = applyProviderErrorContext(
      createAppError("Forbidden", {
        kind: "provider",
        status: 403,
        providerId: "ollama",
        code: "OLC-CORS-BLOCKED"
      }),
      {
        providerId: "ollama",
        providerName: "Ollama",
        model: "glm-5.3:cloud",
        baseUrl: "http://localhost:11434"
      }
    )

    expect(error.messageKey).not.toMatch(/ollama_cloud/)
  })

  it("treats a 401 on a cloud model as sign-in, not CORS", () => {
    const error = applyProviderErrorContext(
      createAppError("Ollama Error (401): unauthorized", {
        kind: "provider",
        status: 401,
        providerId: "ollama",
        code: "OLC-CORS-BLOCKED",
        messageKey: "chat.errors.provider_cors"
      }),
      {
        providerId: "ollama",
        providerName: "Ollama",
        model: "gpt-oss:120b-cloud",
        baseUrl: "http://localhost:11434"
      }
    )

    expect(error.messageKey).toBe("chat.errors.ollama_cloud_signin")
  })

  it("leaves a local model's unreachable failure as unreachable", () => {
    const error = applyProviderErrorContext(
      createAppError("Ollama connection failed", {
        kind: "provider",
        status: 0,
        providerId: "ollama",
        code: "OLC-PROVIDER-UNREACHABLE"
      }),
      { providerId: "ollama", providerName: "Ollama", model: "llama3.2" }
    )

    expect(error.messageKey).toBe("chat.errors.provider_unreachable")
  })

  it("keys a runner crash from the response body", () => {
    const error = applyProviderErrorContext(
      createAppError("Ollama Error (500)", {
        kind: "provider",
        status: 500,
        providerId: "ollama",
        debug: '{"error":"llama runner process has terminated: signal: killed"}'
      }),
      { providerId: "ollama", providerName: "Ollama", model: "qwen3:32b" }
    )

    expect(error.messageKey).toBe("chat.errors.model_crashed")
    expect(error.userMessage).toContain("crashed while loading")
    expect(error.userMessage).not.toContain("HTTP")
  })
})

describe("oversized requests", () => {
  afterEach(() => vi.restoreAllMocks())

  const context = {
    providerId: "ollama",
    providerName: "Ollama",
    model: "m",
    baseUrl: "http://localhost:11434"
  }

  it("clears a stale context-window key and keeps size advice at the background boundary", () => {
    const error = applyProviderErrorContext(
      createAppError("Request too large", {
        kind: "provider",
        status: 413,
        code: "OLC-CONTEXT-TOO-LARGE",
        messageKey: "chat.errors.context_too_long"
      }),
      context
    )
    expect(error.messageKey).toBeUndefined()
    expect(error.userMessage).toContain("smaller image or a shorter message")
    expect(error.userMessage).not.toContain("new chat")
  })

  it("keeps Ollama's HTTP 413 advice through background enrichment", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("request too large", { status: 413 })
    )
    const error = await new OllamaProvider({
      ...context,
      id: "ollama",
      name: "Ollama",
      type: ProviderType.OLLAMA,
      enabled: true
    })
      .streamChat({ model: "m", messages: [] }, () => {})
      .catch((error) => error)
    expect(error).toMatchObject({ status: 413, code: "OLC-CONTEXT-TOO-LARGE" })
    expect(error.messageKey).toBeUndefined()
    expect(applyProviderErrorContext(error, context).userMessage).toContain(
      "smaller image or a shorter message"
    )
  })

  it("keeps Anthropic's streamed 413 advice through background enrichment", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        'event: error\ndata: {"type":"error","error":{"type":"request_too_large","message":"Request too large"}}\n\n',
        { status: 200 }
      )
    )
    const config = {
      id: "custom:anthropic:test",
      name: "Claude",
      baseUrl: "https://api.anthropic.com/v1",
      type: ProviderType.ANTHROPIC,
      enabled: true
    }
    const error = await new AnthropicProvider(config)
      .streamChat({ model: "claude", messages: [] }, () => {})
      .catch((error) => error)
    expect(error).toMatchObject({ status: 413, code: "OLC-CONTEXT-TOO-LARGE" })
    expect(error.messageKey).toBeUndefined()
    expect(
      applyProviderErrorContext(error, {
        providerId: config.id,
        providerName: config.name,
        baseUrl: config.baseUrl
      }).userMessage
    ).toContain("smaller image or a shorter message")
  })
})
