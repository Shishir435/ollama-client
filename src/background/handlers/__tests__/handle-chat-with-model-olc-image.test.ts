import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { isAppError } from "@/lib/error-utils"
import { OpenAICompatibleProvider } from "@/lib/providers/openai-compatible"
import { type ProviderConfig, ProviderType } from "@/lib/providers/types"
import type { ChatWithModelMessage } from "@/types"
import {
  mapCodexImageGenerationModel,
  mapCodexModel
} from "../../../../packages/olc/src/backends/codex/wire"
import { handleChatWithModel } from "../handle-chat-with-model"
import { createMockIsPortClosed, createMockPort } from "./test-utils"

/**
 * olc's Codex backend publishes image generation as its own catalog row and
 * serves it on `/v1/images/generations`. These tests take the rows olc itself
 * builds through the extension's real OpenAI-compatible provider, capability
 * resolution and chat routing, with only `fetch` stubbed. No Codex runs.
 */

const ONE_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+NwL6WQAAAABJRU5ErkJggg=="

const BASE_URL = "http://127.0.0.1:8083/v1"

const olcConfig: ProviderConfig = {
  id: "custom:olc-codex",
  type: ProviderType.OPENAI,
  enabled: true,
  baseUrl: BASE_URL,
  name: "olc codex"
}

const { provider } = vi.hoisted(() => ({
  provider: { current: undefined as unknown }
}))

vi.mock("@/lib/plasmo-global-storage", () => ({
  plasmoSyncStorage: { get: vi.fn(), set: vi.fn() },
  plasmoDeviceStorage: { get: vi.fn(), set: vi.fn() },
  getPlasmoStoredValue: vi.fn().mockResolvedValue(undefined),
  setPlasmoStoredValue: vi.fn().mockResolvedValue(undefined)
}))

vi.mock("@/background/lib/abort-controller-registry", () => ({
  setAbortController: vi.fn(),
  clearAbortController: vi.fn()
}))

vi.mock("@/lib/providers/factory", () => ({
  ProviderFactory: {
    getProviderForModel: vi.fn(async () => provider.current),
    getProvider: vi.fn(async () => provider.current)
  }
}))

const catalog = {
  object: "list",
  data: [
    mapCodexModel({
      id: "gpt-5.6-luna",
      model: "gpt-5.6-luna",
      displayName: "GPT-5.6 Luna",
      isDefault: true
    } as Parameters<typeof mapCodexModel>[0]),
    mapCodexImageGenerationModel()
  ]
}

const sse = (...events: unknown[]) =>
  new Response(
    `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`,
    { status: 200, headers: { "Content-Type": "text/event-stream" } }
  )

type Route = (init?: RequestInit) => Response

const serve = (routes: Record<string, Route>) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input)
    const path = url.slice(BASE_URL.length).split("?")[0]
    const route = routes[path]
    return route ? route(init) : new Response("not found", { status: 404 })
  })

const chat = (model: string): ChatWithModelMessage => ({
  type: "CHAT_WITH_MODEL",
  payload: {
    model,
    providerId: olcConfig.id,
    messages: [{ role: "user", content: "a fox in the snow" }]
  }
})

const posted = (port: ReturnType<typeof createMockPort>) =>
  vi
    .mocked(port.postMessage)
    .mock.calls.map(
      ([message]) => message as unknown as Record<string, unknown>
    )

describe("olc Codex image generation through the extension", () => {
  beforeEach(() => {
    provider.current = new OpenAICompatibleProvider({ ...olcConfig })
  })
  afterEach(() => vi.restoreAllMocks())

  it("sends codex/image-generation to the Images endpoint and stores its bytes", async () => {
    const imageBodies: unknown[] = []
    const fetchSpy = serve({
      "/models": () => Response.json(catalog),
      "/images/generations": (init) => {
        imageBodies.push(JSON.parse(String(init?.body)))
        return Response.json({
          created: 1_792_000_000,
          data: [{ b64_json: ONE_PIXEL_PNG, revised_prompt: "a red fox" }]
        })
      }
    })
    const port = createMockPort("chat-port")

    await handleChatWithModel(
      chat("codex/image-generation"),
      port,
      createMockIsPortClosed(false)
    )

    expect(imageBodies).toEqual([
      {
        model: "codex/image-generation",
        prompt: "a fox in the snow",
        response_format: "b64_json"
      }
    ])
    expect(
      fetchSpy.mock.calls.some(([input]) =>
        String(input).endsWith("/chat/completions")
      )
    ).toBe(false)
    const messages = posted(port)
    expect(messages.some((message) => message.error)).toBe(false)
    const images = messages.flatMap(
      (message) =>
        (message.generatedImages as { mimeType: string }[] | undefined) ?? []
    )
    expect(images).toHaveLength(1)
    expect(images[0].mimeType).toBe("image/png")
  })

  it("keeps an ordinary Codex text model on chat", async () => {
    const chatBodies: { model: string }[] = []
    const fetchSpy = serve({
      "/models": () => Response.json(catalog),
      "/chat/completions": (init) => {
        chatBodies.push(JSON.parse(String(init?.body)))
        return sse(
          { choices: [{ index: 0, delta: { content: "A fox." } }] },
          { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }
        )
      }
    })
    const port = createMockPort("chat-port")

    await handleChatWithModel(
      chat("codex/gpt-5.6-luna"),
      port,
      createMockIsPortClosed(false)
    )

    expect(chatBodies.map((body) => body.model)).toEqual(["codex/gpt-5.6-luna"])
    expect(
      fetchSpy.mock.calls.some(([input]) =>
        String(input).endsWith("/images/generations")
      )
    ).toBe(false)
    expect(posted(port).some((message) => message.error)).toBe(false)
  })

  it("names olc's 501 instead of retrying the prompt as chat", async () => {
    /**
     * olc answers 501 when the running backend has no image operation
     * (`core/image-route.ts`). Falling back to chat there would have Codex
     * answer the image request in text — the disguised fallback olc refuses.
     */
    const fetchSpy = serve({
      "/images/generations": () =>
        Response.json(
          {
            error: {
              message: "Backend 'opencode' does not support image generation",
              type: "UnsupportedOperation"
            }
          },
          { status: 501 }
        )
    })

    const error = await (provider.current as OpenAICompatibleProvider)
      .generateImage(
        { model: "codex/image-generation", prompt: "a fox in the snow" },
        () => {}
      )
      .then(
        () => undefined,
        (failure: unknown) => failure
      )

    expect(
      fetchSpy.mock.calls.some(([input]) =>
        String(input).endsWith("/chat/completions")
      )
    ).toBe(false)
    expect(isAppError(error)).toBe(true)
    if (!isAppError(error)) return
    expect(error.status).toBe(501)
    expect(error.messageKey).toBe("chat.errors.image_generation_not_offered")
    expect(error.userMessage).toBe(
      "Image generation isn't available here. Choose a chat model, or a provider and model that generate images."
    )
  })
})
