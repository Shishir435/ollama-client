import { describe, expect, it } from "vitest"
import { createAppError } from "@/lib/error-utils"
import { ProviderType } from "@/lib/providers/types"
import {
  classifyProviderConnectionFailure,
  OLLAMA_CORS_MESSAGE_KEY,
  providerConnectionError,
  providerConnectionFailureMessageKey
} from "../provider-connection"

const local = { baseUrl: "http://localhost:11434" }
const remote = { baseUrl: "https://api.example.com/v1" }

const status = (code: number) =>
  createAppError(`HTTP ${code}`, { kind: "provider", status: code })

describe("classifyProviderConnectionFailure", () => {
  it("keeps opaque network failures honest", () => {
    expect(
      classifyProviderConnectionFailure(new TypeError("Failed to fetch"), local)
    ).toBe("unavailable")
    expect(
      classifyProviderConnectionFailure(
        createAppError("down", { kind: "provider", status: 0 }),
        local
      )
    ).toBe("unavailable")
  })

  it("reads a local 401/403 as the server refusing the extension origin", () => {
    expect(classifyProviderConnectionFailure(status(403), local)).toBe("cors")
    expect(classifyProviderConnectionFailure(status(401), local)).toBe("cors")
  })

  it("reads a remote 401/403 as a rejected key", () => {
    expect(classifyProviderConnectionFailure(status(401), remote)).toBe("auth")
    expect(classifyProviderConnectionFailure(status(403), remote)).toBe("auth")
  })

  it("separates a wrong base URL, a timeout and a server error", () => {
    expect(classifyProviderConnectionFailure(status(404), local)).toBe(
      "not-found"
    )
    expect(classifyProviderConnectionFailure(status(504), local)).toBe(
      "timeout"
    )
    expect(
      classifyProviderConnectionFailure(
        new DOMException("timed out", "TimeoutError"),
        local
      )
    ).toBe("timeout")
    expect(classifyProviderConnectionFailure(status(500), local)).toBe(
      "server-error"
    )
  })
})

describe("providerConnectionFailureMessageKey", () => {
  it("offers the OLLAMA_ORIGINS command only to Ollama", () => {
    expect(
      providerConnectionFailureMessageKey("cors", ProviderType.OLLAMA)
    ).toBe(OLLAMA_CORS_MESSAGE_KEY)
    expect(
      providerConnectionFailureMessageKey("cors", ProviderType.OPENAI)
    ).toBe("onboarding.provider.errors.cors-other")
    expect(
      providerConnectionFailureMessageKey("unavailable", ProviderType.OLLAMA)
    ).toBe("onboarding.provider.errors.unavailable")
  })
})

describe("providerConnectionError", () => {
  it("carries a key, the provider name and safe text, never the raw cause", () => {
    const error = providerConnectionError(
      new TypeError("Failed to fetch http://user:secret@localhost:11434"),
      {
        id: "ollama",
        type: ProviderType.OLLAMA,
        enabled: true,
        name: "Ollama",
        baseUrl: "http://localhost:11434"
      },
      "ollama"
    )

    expect(error).toMatchObject({
      kind: "provider",
      code: "OLC-PROVIDER-UNREACHABLE",
      messageKey: "onboarding.provider.errors.unavailable",
      messageParams: { provider: "Ollama" },
      retryable: true
    })
    expect(error.status).toBeUndefined()
    expect(error.userMessage).toBe(
      "Can't reach Ollama. Start it, then retry. If it's running, check the base URL."
    )
    expect(error.userMessage).not.toContain("secret")
  })
})

describe("classifyProviderConnectionFailure for Ollama and quota statuses", () => {
  it("reads a remote Ollama 403 as the origin block, not a rejected key", () => {
    const error = createAppError("Forbidden", { kind: "provider", status: 403 })
    expect(
      classifyProviderConnectionFailure(error, {
        baseUrl: "https://llm.example.com",
        type: ProviderType.OLLAMA
      })
    ).toBe("cors")
  })

  it("separates rate limits and payment from server errors", () => {
    const config = { baseUrl: "https://api.example.com" }
    expect(
      classifyProviderConnectionFailure(
        createAppError("Too many", { kind: "provider", status: 429 }),
        config
      )
    ).toBe("rate-limited")
    expect(
      classifyProviderConnectionFailure(
        createAppError("Pay", { kind: "provider", status: 402 }),
        config
      )
    ).toBe("payment")
  })
})
