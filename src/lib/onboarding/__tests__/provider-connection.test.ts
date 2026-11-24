import { afterEach, describe, expect, it, vi } from "vitest"
import { createAppError } from "@/lib/error-utils"
import { ProviderType } from "@/lib/providers/types"
import {
  classifyProviderConnectionFailure,
  detectOllamaHostOs,
  diagnoseProviderConnectionFailure,
  isOriginsFixMessageKey,
  OLLAMA_BLOCKED_MESSAGE_KEY,
  probeHostListening,
  OLLAMA_ORIGINS_COMMANDS,
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

describe("detectOllamaHostOs", () => {
  it("maps user agents to the OS whose instructions apply", () => {
    expect(detectOllamaHostOs("Mozilla/5.0 (Macintosh; Intel Mac OS X)")).toBe(
      "macos"
    )
    expect(detectOllamaHostOs("Mozilla/5.0 (Windows NT 10.0; Win64)")).toBe(
      "windows"
    )
    expect(detectOllamaHostOs("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux")
  })

  it("gives macOS and Windows an environment command, not a second server", () => {
    expect(OLLAMA_ORIGINS_COMMANDS.macos).toContain("launchctl setenv")
    expect(OLLAMA_ORIGINS_COMMANDS.windows).toContain("setx OLLAMA_ORIGINS")
    expect(OLLAMA_ORIGINS_COMMANDS.linux).toContain("ollama serve")
  })
})

describe("telling a stopped server from one that refuses the extension", () => {
  const ollama = {
    id: "ollama",
    name: "Ollama",
    type: ProviderType.OLLAMA,
    baseUrl: "http://localhost:11434"
  } as never
  const networkFailure = new TypeError("Failed to fetch")

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("keeps a bare network error `unavailable` unless something answers", () => {
    expect(classifyProviderConnectionFailure(networkFailure, local)).toBe(
      "unavailable"
    )
    expect(
      classifyProviderConnectionFailure(networkFailure, local, {
        listening: true
      })
    ).toBe("blocked")
  })

  it("never reads an answering remote host as a local origin block", () => {
    expect(
      classifyProviderConnectionFailure(networkFailure, remote, {
        listening: true
      })
    ).toBe("unavailable")
  })

  it("probes with a bare no-cors request and reports an answer", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ type: "opaque" })
    vi.stubGlobal("fetch", fetchMock)

    await expect(probeHostListening("http://localhost:11434/v1")).resolves.toBe(
      true
    )
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:11434/",
      expect.objectContaining({ mode: "no-cors", credentials: "omit" })
    )
  })

  it("reports nothing listening when the connection is refused", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("refused")))
    await expect(probeHostListening("http://localhost:11434")).resolves.toBe(
      false
    )
  })

  it("gives the origins fix to a host that answers but refused us", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ type: "opaque" }))

    const error = await diagnoseProviderConnectionFailure(
      networkFailure,
      ollama,
      "ollama"
    )

    expect(error.messageKey).toBe(OLLAMA_BLOCKED_MESSAGE_KEY)
    expect(isOriginsFixMessageKey(error.messageKey)).toBe(true)
    expect(error.code).toBe("OLC-CORS-BLOCKED")
  })

  it("says the server is stopped when nothing answers, with no origins fix", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("refused")))

    const error = await diagnoseProviderConnectionFailure(
      networkFailure,
      ollama,
      "ollama"
    )

    expect(error.messageKey).toBe("onboarding.provider.errors.unavailable")
    expect(isOriginsFixMessageKey(error.messageKey)).toBe(false)
  })

  it("does not probe for an answer it will not use", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await diagnoseProviderConnectionFailure(
      createAppError("Boom", { kind: "provider", status: 500 }),
      ollama,
      "ollama"
    )
    await diagnoseProviderConnectionFailure(
      networkFailure,
      {
        ...(ollama as object),
        type: ProviderType.OPENAI,
        baseUrl: "https://api.example.com"
      } as never,
      "custom"
    )

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
