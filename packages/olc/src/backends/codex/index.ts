/** Codex app-server adapter for OLC's runtime-neutral backend port. */
import fs from "node:fs"
import { buildPromptParts } from "../../core/openai-wire.js"
import type { ToolResultMessage } from "../../types.js"
import { isRecord } from "../../util.js"
import type {
  AgentBackend,
  BackendContext,
  BackendTurn,
  CatalogModel,
  StartTurnInput,
  TurnResult,
  TurnRunSignals,
  TurnStreamHandlers
} from "../types.js"
import { BackendInputError } from "../types.js"
import {
  type AppServerMessage,
  CodexAppServerClient
} from "./app-server-client.js"
import { resolveCodexConfig } from "./config.js"
import {
  type CodexModel,
  mapCodexModel,
  resolveCodexReasoningEffort,
  toDynamicTools
} from "./wire.js"

interface ThreadStartResponse {
  thread?: { id?: string }
}

interface TurnStartResponse {
  turn?: { id?: string }
}

interface ModelListResponse {
  data?: CodexModel[]
  nextCursor?: string | null
}

type QueueResult =
  | { type: "message"; message: AppServerMessage }
  | { type: "suspended" }

class MessageQueue {
  private readonly messages: AppServerMessage[] = []
  private readonly waiters = new Set<(message: AppServerMessage) => void>()

  push(message: AppServerMessage): void {
    const waiter = this.waiters.values().next().value
    if (waiter) {
      this.waiters.delete(waiter)
      waiter(message)
      return
    }
    this.messages.push(message)
  }

  async next(suspended: Promise<void>): Promise<QueueResult> {
    const queued = this.messages.shift()
    if (queued) return { type: "message", message: queued }

    let waiter: ((message: AppServerMessage) => void) | undefined
    const message = new Promise<AppServerMessage>((resolve) => {
      waiter = resolve
      this.waiters.add(resolve)
    })
    const result = await Promise.race([
      message.then((value) => ({ type: "message" as const, message: value })),
      suspended.then(() => ({ type: "suspended" as const }))
    ])
    if (waiter) this.waiters.delete(waiter)
    return result
  }
}

export const createCodexBackend = (context: BackendContext): AgentBackend => {
  const { config, log } = context
  const codex = resolveCodexConfig({
    options: context.options,
    fileOptions: context.fileOptions
  })
  fs.mkdirSync(codex.PROJECT_DIR, { recursive: true })

  const client = new CodexAppServerClient({
    executable: codex.CODEX_PATH,
    cwd: codex.PROJECT_DIR,
    log,
    requestTimeoutMs: Math.min(config.REQUEST_TIMEOUT_MS, 60_000)
  })
  const turns = new Map<string, CodexTurn>()
  let catalogCache: { expiresAt: number; raw: CodexModel[] } | null = null

  const unsubscribe = client.onNotification((message) => {
    const params = isRecord(message.params) ? message.params : {}
    const threadId =
      typeof params.threadId === "string" ? params.threadId : undefined
    if (threadId) turns.get(threadId)?.push(message)
    if (message.method === "olc/appServerExited") {
      for (const turn of turns.values()) turn.push(message)
    }
  })

  client.setServerRequestHandler(async (message) => {
    const params = isRecord(message.params) ? message.params : {}
    if (message.method === "item/tool/call") {
      const threadId = String(params.threadId ?? "")
      const turn = turns.get(threadId)
      if (!turn) throw new Error("Codex requested a tool for an unknown turn")
      try {
        const output = await context.callClientTool({
          turnId: turn.id,
          tool: String(params.tool ?? "tool"),
          args: params.arguments ?? {},
          signal: turn.signal
        })
        return {
          contentItems: [{ type: "inputText", text: output }],
          success: true
        }
      } catch (error) {
        return {
          contentItems: [
            {
              type: "inputText",
              text: `Tool failed: ${(error as Error).message}`
            }
          ],
          success: false
        }
      }
    }

    if (message.method === "item/commandExecution/requestApproval") {
      return { decision: "decline" }
    }
    if (message.method === "item/fileChange/requestApproval") {
      return { decision: "decline" }
    }
    if (message.method === "execCommandApproval") {
      return { decision: "denied" }
    }
    if (message.method === "applyPatchApproval") {
      return { decision: "denied" }
    }
    return undefined
  })

  const loadRawModels = async (): Promise<CodexModel[]> => {
    if (catalogCache && catalogCache.expiresAt > Date.now()) {
      return catalogCache.raw
    }
    await client.start()
    const models: CodexModel[] = []
    let cursor: string | null = null
    do {
      const page: ModelListResponse = await client.request<ModelListResponse>(
        "model/list",
        {
          limit: 100,
          includeHidden: false,
          ...(cursor ? { cursor } : {})
        }
      )
      if (Array.isArray(page?.data)) models.push(...page.data)
      cursor = typeof page?.nextCursor === "string" ? page.nextCursor : null
    } while (cursor)
    catalogCache = { raw: models, expiresAt: Date.now() + 30_000 }
    return models
  }

  class CodexTurn implements BackendTurn {
    readonly id: string
    readonly signal: AbortSignal
    private readonly abortController = new AbortController()
    private readonly queue = new MessageQueue()
    private readonly input: StartTurnInput
    private codexTurnId: string | null = null
    private started = false
    private content = ""
    private reasoning = ""
    private lastError: string | null = null

    constructor(threadId: string, input: StartTurnInput) {
      this.id = threadId
      this.input = input
      this.signal = this.abortController.signal
    }

    push(message: AppServerMessage): void {
      this.queue.push(message)
    }

    async run(
      handlers: TurnStreamHandlers,
      signals: TurnRunSignals
    ): Promise<TurnResult> {
      if (!this.started) {
        this.started = true
        const prompt = buildPromptParts(this.input.messages)
        const response = await client.request<TurnStartResponse>("turn/start", {
          threadId: this.id,
          input: prompt.parts.map((part) =>
            part.type === "file"
              ? { type: "image", url: part.url }
              : { type: "text", text: part.text, text_elements: [] }
          ),
          ...(this.input.reasoningEffort
            ? { effort: this.input.reasoningEffort }
            : {})
        })
        const turnId = response?.turn?.id
        if (!turnId) throw new Error("Codex did not return a turn id")
        this.codexTurnId = turnId
      }
      return await this.readLeg(handlers, signals)
    }

    async resume(
      _results: ToolResultMessage[],
      handlers: TurnStreamHandlers,
      signals: TurnRunSignals
    ): Promise<TurnResult> {
      signals.releaseToolResults?.()
      return await this.readLeg(handlers, signals)
    }

    async abort(): Promise<void> {
      this.abortController.abort()
      if (!this.codexTurnId) return
      try {
        await client.request("turn/interrupt", {
          threadId: this.id,
          turnId: this.codexTurnId
        })
      } catch (error) {
        log("Codex turn interrupt failed", {
          threadId: this.id,
          message: (error as Error).message
        })
      }
    }

    async dispose(): Promise<void> {
      turns.delete(this.id)
      try {
        await client.request("thread/delete", { threadId: this.id })
      } catch (error) {
        log("Codex thread cleanup failed", {
          threadId: this.id,
          message: (error as Error).message
        })
      }
    }

    private async readLeg(
      handlers: TurnStreamHandlers,
      signals: TurnRunSignals
    ): Promise<TurnResult> {
      while (true) {
        const next = await this.queue.next(signals.suspended)
        if (next.type === "suspended") return { status: "suspended" }
        const { method } = next.message
        const params = isRecord(next.message.params) ? next.message.params : {}

        if (method === "item/agentMessage/delta") {
          const delta = typeof params.delta === "string" ? params.delta : ""
          this.content += delta
          handlers.onText(delta)
          continue
        }
        if (method === "item/reasoning/summaryTextDelta") {
          const delta = typeof params.delta === "string" ? params.delta : ""
          this.reasoning += delta
          handlers.onReasoning(delta)
          continue
        }
        if (method === "item/completed" && isRecord(params.item)) {
          if (
            params.item.type === "agentMessage" &&
            typeof params.item.text === "string" &&
            !this.content
          ) {
            this.content = params.item.text
          }
          continue
        }
        if (method === "error") {
          const error = isRecord(params.error) ? params.error : {}
          if (typeof error.message === "string") this.lastError = error.message
          continue
        }
        if (method === "olc/appServerExited") {
          return {
            status: "failed",
            error: {
              type: "CodexAppServerExited",
              message: String(params.message ?? "Codex app-server exited")
            }
          }
        }
        if (method !== "turn/completed" || !isRecord(params.turn)) continue

        const status = String(params.turn.status ?? "failed")
        if (status === "completed") {
          return {
            status: "completed",
            content: this.content,
            reasoning: this.reasoning,
            finish: "stop"
          }
        }
        const turnError = isRecord(params.turn.error) ? params.turn.error : {}
        return {
          status: "failed",
          error: {
            type: status === "interrupted" ? "CodexInterrupted" : "CodexError",
            message:
              (typeof turnError.message === "string" && turnError.message) ||
              this.lastError ||
              `Codex turn ended with status '${status}'`
          }
        }
      }
    }
  }

  return {
    id: "codex",
    ensureReady: () => client.start(),
    listModels: async (): Promise<CatalogModel[]> =>
      (await loadRawModels()).map((model) =>
        mapCodexModel(model, config.BRIDGE_ENABLED)
      ),
    resolveModel: async (requested) => {
      const models = await loadRawModels()
      const raw = typeof requested === "string" ? requested.trim() : ""
      const wanted = raw.startsWith("codex/") ? raw.slice("codex/".length) : raw
      const match = wanted
        ? models.find((model) => model.id === wanted || model.model === wanted)
        : (models.find((model) => model.isDefault) ?? models[0])
      return match
        ? { providerId: "codex", modelId: match.id }
        : {
            error: wanted
              ? `Codex model '${wanted}' is not available`
              : "Codex returned no available models"
          }
    },
    startTurn: async (input) => {
      await client.start()
      if (input.reasoningEffort) {
        const resolved = resolveCodexReasoningEffort(
          await loadRawModels(),
          input.model.modelId,
          input.reasoningEffort
        )
        if ("error" in resolved) throw new BackendInputError(resolved.error)
      }
      const prompt = buildPromptParts(input.messages)
      const tools = config.BRIDGE_ENABLED ? toDynamicTools(input.tools) : []
      const response = await client.request<ThreadStartResponse>(
        "thread/start",
        {
          model: input.model.modelId,
          cwd: codex.PROJECT_DIR,
          approvalPolicy: "never",
          sandbox: "read-only",
          ephemeral: true,
          serviceName: "ollama_client_olc",
          ...(config.SYSTEM_PROMPT || prompt.system
            ? { developerInstructions: config.SYSTEM_PROMPT || prompt.system }
            : {}),
          ...(tools.length > 0 ? { dynamicTools: tools } : {})
        }
      )
      const threadId = response?.thread?.id
      if (!threadId) throw new Error("Codex did not return a thread id")
      const turn = new CodexTurn(threadId, input)
      turns.set(threadId, turn)
      return turn
    },
    findTurn: (turnId) => turns.get(turnId),
    shutdown: async () => {
      unsubscribe()
      await Promise.allSettled([...turns.values()].map((turn) => turn.abort()))
      turns.clear()
      await client.shutdown()
    }
  }
}
