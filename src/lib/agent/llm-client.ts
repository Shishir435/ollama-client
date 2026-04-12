import type { ChromePort } from "@/types"
import type { AgentLLMMessage } from "./context-manager"
import { BROWSER_TOOLS } from "./tools"
import type { AgentStreamMessage } from "./types"

const MODEL_WAIT_HEARTBEAT_MS = 10_000

export class LLMClient {
  private currentAbort: AbortController | null = null

  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly port: ChromePort
  ) {}

  private postStep(msg: AgentStreamMessage) {
    try {
      this.port.postMessage(
        msg as unknown as Parameters<typeof this.port.postMessage>[0]
      )
    } catch {
      // ignore
    }
  }

  public abort() {
    this.currentAbort?.abort()
  }

  public async callLLM(
    msgs: AgentLLMMessage[],
    withTools: boolean
  ): Promise<{ content: string; tool_calls?: unknown[] }> {
    this.currentAbort = new AbortController()
    const timeoutId = setTimeout(() => this.currentAbort?.abort(), 300_000)
    const requestStartedAt = Date.now()

    const heartbeatId = setInterval(() => {
      this.postStep({
        type: "status",
        status: "running",
        heartbeat: true,
        message: `Waiting for local model response... ${Math.floor((Date.now() - requestStartedAt) / 1000)}s`
      })
    }, MODEL_WAIT_HEARTBEAT_MS)

    let raw: Response
    try {
      raw = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages: msgs,
          ...(withTools ? { tools: BROWSER_TOOLS } : {}),
          stream: false,
          options: {
            num_ctx: 32768
          }
        }),
        signal: this.currentAbort.signal
      })
    } catch (err) {
      clearInterval(heartbeatId)
      clearTimeout(timeoutId)
      const isTimeout = (err as Error)?.name === "AbortError"
      throw new Error(
        isTimeout
          ? "Request timed out after 300s. Local model is taking too long to process the page context."
          : `Cannot reach Ollama at ${this.baseUrl}: ${err instanceof Error ? err.message : String(err)}`
      )
    }

    clearInterval(heartbeatId)
    clearTimeout(timeoutId)
    this.currentAbort = null

    if (!raw.ok) {
      const errText = await raw.text()
      throw new Error(`Ollama error (${raw.status}): ${errText}`)
    }

    const data = await raw.json()
    return data.message ?? { content: "" }
  }

  public parseJsonAction(content: string): Record<string, unknown> | null {
    const clean = content
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim()
    const match = clean.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[0])
    } catch {
      return null
    }
  }
}
