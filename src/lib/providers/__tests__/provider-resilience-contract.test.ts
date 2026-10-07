import { afterEach, describe, expect, it, vi } from "vitest"
import { AnthropicProvider } from "../anthropic"
import { OllamaProvider } from "../ollama"
import { OpenAICompatibleProvider } from "../openai-compatible"
import { ProviderId, ProviderType } from "../types"
import { streamResponse } from "./provider-contract-fixtures"

const request = {
  model: "test",
  messages: [{ role: "user" as const, content: "Read" }]
}
const remote = {
  id: "custom:selected",
  type: ProviderType.OPENAI,
  enabled: true,
  name: "Selected",
  baseUrl: "https://provider.test/v1"
}
afterEach(() => vi.restoreAllMocks())

describe("provider failure wire contracts", () => {
  it.each([
    { delta: { refusal: "private refusal text" } },
    { message: { refusal: "private refusal text" } },
    { delta: {}, finish_reason: "content_filter" }
  ])("retains OpenAI refusal separately from missing tool output", async (choice) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      streamResponse([`data: ${JSON.stringify({ choices: [choice] })}\n\n`])
    )
    await expect(
      new OpenAICompatibleProvider(remote).streamChat(request, vi.fn())
    ).rejects.toMatchObject({
      code: "OLC-MODEL-REFUSED",
      retryable: false,
      userMessage: expect.not.stringContaining("private refusal")
    })
  })

  it("retains Anthropic's refusal stop reason", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      streamResponse([
        'data: {"type":"message_delta","delta":{"stop_reason":"refusal"}}\n\n'
      ])
    )
    await expect(
      new AnthropicProvider({
        ...remote,
        type: ProviderType.ANTHROPIC
      }).streamChat(request, vi.fn())
    ).rejects.toMatchObject({ code: "OLC-MODEL-REFUSED", retryable: false })
  })

  it.each([
    ["authentication_error", 401, false, "OLC-AUTH-FAILED"],
    ["permission_error", 403, false, "OLC-AUTH-FAILED"],
    ["rate_limit_error", 429, true, "OLC-RATE-LIMITED"],
    ["api_error", 500, true, "OLC-PROVIDER-HTTP"],
    ["overloaded_error", 529, true, "OLC-PROVIDER-OVERLOADED"]
  ])("maps Anthropic %s to a typed failure", async (type, status, retryable, code) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      streamResponse([
        `data: ${JSON.stringify({ type: "error", error: { type, message: "private detail" } })}\n\n`
      ])
    )
    await expect(
      new AnthropicProvider({
        ...remote,
        type: ProviderType.ANTHROPIC
      }).streamChat(request, vi.fn())
    ).rejects.toMatchObject({
      status,
      retryable,
      code,
      userMessage: expect.not.stringContaining("private detail")
    })
  })

  it.each([
    429, 503
  ])("retains Ollama HTTP %s retry guidance", async (status) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("private detail", {
        status,
        headers: { "Retry-After": "2" }
      })
    )
    await expect(
      new OllamaProvider({
        ...remote,
        id: ProviderId.OLLAMA,
        type: ProviderType.OLLAMA,
        baseUrl: "http://localhost:11434"
      }).streamChat(request, vi.fn())
    ).rejects.toMatchObject({ status, retryable: true, retryAfterMs: 2_000 })
  })
})
