import type {
  ChatRequest,
  EmbeddingSupport,
  LLMProvider,
  ProviderConfig
} from "@/lib/providers/types"
import type { ChatStreamMessage, ProviderModel } from "@/types"

export class AnthropicProvider implements LLMProvider {
  id = "anthropic"

  constructor(public config: ProviderConfig) {}

  async getModels(): Promise<ProviderModel[]> {
    // Anthropic doesn't have a public models list endpoint that is easily CORS accessible
    // usually. But we can return a hardcoded list of popular models or try if they add one.
    // For now, hardcode the main ones.
    const models = [
      "claude-3-5-sonnet-20241022",
      "claude-3-5-haiku-20241022",
      "claude-3-opus-20240229",
      "claude-3-sonnet-20240229",
      "claude-3-haiku-20240307"
    ]

    return models.map((m) => ({
      name: m,
      model: m,
      modified_at: new Date().toISOString(),
      size: 0,
      digest: "",
      details: {
        parent_model: "",
        format: "",
        family: "anthropic",
        families: [],
        parameter_size: "",
        quantization_level: ""
      }
    }))
  }

  async streamChat(
    request: ChatRequest,
    onChunk: (chunk: ChatStreamMessage) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const { model, messages, temperature, max_tokens, top_p } = request
    const baseUrl = this.config.baseUrl || "https://api.anthropic.com/v1"

    if (!this.config.apiKey) {
      throw new Error("Anthropic API Key is missing")
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": this.config.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true" // Required for client-side calls
    }

    // Extract system message
    const systemMessage = messages.find((m) => m.role === "system")
    const userAssistantMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role,
        content: m.content
      }))

    const body = {
      model,
      messages: userAssistantMessages,
      system: systemMessage?.content,
      stream: true,
      max_tokens: max_tokens || 4096,
      temperature,
      top_p
    }

    const response = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Anthropic Error (${response.status}): ${errorText}`)
    }

    await this.processEventStream(response, onChunk)
  }

  async getEmbeddingSupport(): Promise<EmbeddingSupport> {
    return {
      supported: false,
      mode: "none",
      notes: "Anthropic chat API does not provide embedding generation here."
    }
  }

  private async processEventStream(
    response: Response,
    onChunk: (chunk: ChatStreamMessage) => void
  ) {
    const reader = response.body?.getReader()
    if (!reader) throw new Error("Response body is null")

    const decoder = new TextDecoder()
    let buffer = ""

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          onChunk({ done: true })
          break
        }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue

          if (trimmed.startsWith("event: ")) {
            // Event type line
            continue
          }

          if (trimmed.startsWith("data: ")) {
            try {
              const json = JSON.parse(trimmed.slice(6))

              switch (json.type) {
                case "content_block_delta":
                  if (json.delta?.type === "text_delta") {
                    onChunk({
                      delta: json.delta.text,
                      done: false
                    })
                  }
                  break
                case "message_stop":
                  onChunk({ done: true })
                  // Verify if we should break here or let loop finish
                  break
                case "error":
                  onChunk({
                    error: {
                      status:
                        json.error?.type === "authentication_error" ? 401 : 500,
                      message: json.error?.message || "Anthropic Error"
                    }
                  })
                  return
              }
            } catch (_e) {
              // ignore
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }
}
