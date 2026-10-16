import { createAppError } from "@/lib/error-utils"
import type { ChatStreamMessage, ProviderModel } from "@/types"
import { getProviderCapabilities } from "../capabilities"
import { assertProviderEnabled } from "../provider-policy"
import {
  ProviderId,
  type ChatRequest,
  type LLMProvider,
  type ProviderConfig
} from "../types"
import type { PromptMessage } from "./api"
import { browserModelAvailability, callBrowserModelHost } from "./bridge"
import { browserModelError } from "./errors"

export const BROWSER_MODEL_ID = "browser-built-in/text"

/** Text chat only. Browser-managed weights are independent of the RAG embedder. */
export class BrowserBuiltInProvider implements LLMProvider {
  readonly id = ProviderId.BROWSER
  readonly capabilities = getProviderCapabilities(ProviderId.BROWSER)!
  constructor(readonly config: ProviderConfig) {
    if (config.id !== ProviderId.BROWSER)
      throw createAppError("Invalid browser provider identity", {
        kind: "validation"
      })
  }

  async getModels(signal?: AbortSignal): Promise<ProviderModel[]> {
    signal?.throwIfAborted()
    if (!this.config.enabled) return []
    const availability = await browserModelAvailability(signal)
    if (availability !== "available")
      throw browserModelError(
        availability === "unavailable" ? "unavailable" : "not-ready"
      )
    return [
      {
        name: BROWSER_MODEL_ID,
        model: BROWSER_MODEL_ID,
        modified_at: "",
        size: 0,
        digest: "",
        providerId: this.id,
        providerName: "Browser built-in",
        details: {
          parent_model: "",
          format: "",
          family: "",
          families: [],
          parameter_size: "",
          quantization_level: ""
        },
        capabilityHints: {
          modalities: ["text"],
          outputModalities: ["text"],
          supportedParameters: []
        }
      }
    ]
  }

  async getEmbeddingSupport() {
    return { supported: false, mode: "none" as const }
  }

  async streamChat(
    request: ChatRequest,
    onChunk: (chunk: ChatStreamMessage) => void,
    signal?: AbortSignal
  ): Promise<void> {
    signal?.throwIfAborted()
    assertProviderEnabled(this, request.model)
    if (
      request.model !== BROWSER_MODEL_ID ||
      request.tools?.length ||
      request.tool_choice === "required" ||
      request.messages.some(
        (m) => m.role === "tool" || m.images?.length || m.toolCalls?.length
      )
    ) {
      throw createAppError("Browser built-in supports text chat only", {
        kind: "validation",
        providerId: this.id,
        messageKey: "settings.providers.browser_builtin.text_only",
        userMessage:
          "Browser built-in supports text chat only; images and tool conversations require another model."
      })
    }
    const messages: PromptMessage[] = request.messages.map((m) => ({
      role: m.role as PromptMessage["role"],
      content: m.content
    }))
    await callBrowserModelHost(
      { op: "stream", messages },
      (event) => {
        if (event.type === "delta") onChunk({ delta: event.delta, done: false })
        if (event.type === "done") onChunk({ done: true })
      },
      signal
    )
  }
}
