import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const guard = vi.hoisted(() => ({ active: true }))

vi.mock("@/lib/origin-guard-support", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/origin-guard-support")>()),
  supportsProviderOriginGuard: () => guard.active
}))

import { createAppError, isAppError } from "@/lib/error-utils"
import { classifyProviderConnectionFailure } from "@/lib/onboarding/provider-connection"
import { OllamaProvider } from "../ollama"
import {
  providerErrorUserMessage,
  providerFailureMessageKey,
  throwProviderResponseError
} from "../provider-errors"
import { ProviderId, ProviderType } from "../types"

const forbidden = (status = 403) =>
  new Response("forbidden", { status, statusText: "Forbidden" })

const ollamaFailure = async (status: number) => {
  vi.mocked(fetch).mockResolvedValue(forbidden(status))
  const provider = new OllamaProvider({
    id: ProviderId.OLLAMA,
    type: ProviderType.OLLAMA,
    name: "Ollama",
    baseUrl: "http://localhost:11434",
    enabled: true
  })
  try {
    await provider.streamChat(
      { model: "llama3", messages: [{ role: "user", content: "hi" }] },
      () => {}
    )
  } catch (error) {
    if (isAppError(error)) return error
    throw error
  }
  throw new Error("expected a failure")
}

const compatibleFailure = async (baseUrl: string, status = 403) => {
  try {
    await throwProviderResponseError(forbidden(status), {
      label: "Chat failed",
      providerId: "custom:ollama-proxy",
      providerName: "My Ollama",
      baseUrl
    })
  } catch (error) {
    if (isAppError(error)) return error
    throw error
  }
  throw new Error("expected a failure")
}

beforeEach(() => {
  guard.active = true
  vi.stubGlobal("fetch", vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("401/403 copy where the browser removes Origin", () => {
  it("does not send a local Ollama 403 to OLLAMA_ORIGINS", async () => {
    const error = await ollamaFailure(403)

    expect(error.code).toBe("OLC-AUTH-FAILED")
    expect(error.messageKey).toBe("chat.errors.provider_forbidden")
    expect(error.userMessage).not.toMatch(/OLLAMA_ORIGINS|CORS/)
    expect(error.userMessage).toContain("refused this request")
  })

  it("names a refusal, not an origin block, for a custom provider on Ollama's port", async () => {
    const error = await compatibleFailure("https://ollama.example.com:11434/v1")

    expect(error.code).toBe("OLC-AUTH-FAILED")
    expect(error.userMessage).not.toMatch(/OLLAMA_ORIGINS/)
  })

  it("keeps the API-key copy for a remote 401", () => {
    expect(
      providerErrorUserMessage(401, {
        providerName: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1"
      })
    ).toBe("OpenRouter rejected the API key. Check it in provider settings.")
    expect(
      providerFailureMessageKey({
        code: "OLC-AUTH-FAILED",
        status: 401,
        baseUrl: "https://openrouter.ai/api/v1"
      })
    ).toBe("chat.errors.provider_auth")
  })

  it("classifies a connection test's local 403 as refused, not cors", () => {
    const error = createAppError("Forbidden", { kind: "provider", status: 403 })

    expect(
      classifyProviderConnectionFailure(error, {
        baseUrl: "http://localhost:11434",
        type: ProviderType.OLLAMA
      })
    ).toBe("refused")
  })
})

describe("401/403 copy where the browser cannot remove Origin", () => {
  beforeEach(() => {
    guard.active = false
  })

  it("keeps the OLLAMA_ORIGINS advice for local Ollama", async () => {
    const error = await ollamaFailure(403)

    expect(error.code).toBe("OLC-CORS-BLOCKED")
    expect(error.messageKey).toBe("chat.errors.provider_cors")
  })

  it("mentions OLLAMA_ORIGINS for a remote custom provider on Ollama's port", async () => {
    const error = await compatibleFailure("https://ollama.example.com:11434/v1")

    expect(error.code).toBe("OLC-CORS-BLOCKED")
    expect(error.messageKey).toBe("chat.errors.provider_cors_remote")
    expect(error.userMessage).toContain("OLLAMA_ORIGINS")
    expect(error.userMessage).not.toContain("API key")
  })

  it("keeps the API-key copy for a remote provider that is not on Ollama's port", async () => {
    const error = await compatibleFailure("https://api.example.com/v1")

    expect(error.code).toBe("OLC-AUTH-FAILED")
    expect(error.userMessage).not.toContain("OLLAMA_ORIGINS")
  })

  it("classifies a connection test's local 403 as the origin block", () => {
    const error = createAppError("Forbidden", { kind: "provider", status: 403 })

    expect(
      classifyProviderConnectionFailure(error, {
        baseUrl: "http://localhost:11434",
        type: ProviderType.OLLAMA
      })
    ).toBe("cors")
  })
})
