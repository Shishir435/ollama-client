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
  GeneratedImage,
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
  mapCodexImageGenerationModel,
  mapCodexModel,
  resolveCodexReasoningEffort,
  routeCodexWebSearch,
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

interface ModelProviderCapabilities {
  imageGeneration?: boolean
  webSearch?: boolean
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
  let providerCapabilitiesCache: {
    expiresAt: number
    imageGeneration: boolean
    webSearch: boolean
  } | null = null

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

  const loadProviderCapabilities = async (): Promise<{
    imageGeneration: boolean
    webSearch: boolean
  }> => {
    if (
      providerCapabilitiesCache &&
      providerCapabilitiesCache.expiresAt > Date.now()
    ) {
      return providerCapabilitiesCache
    }
    await client.start()
    let imageGeneration = false
    let webSearch = false
    try {
      const capabilities = await client.request<ModelProviderCapabilities>(
        "modelProvider/capabilities/read",
        {}
      )
      imageGeneration = capabilities?.imageGeneration === true
      webSearch = capabilities?.webSearch === true
    } catch (error) {
      // Older App Server builds do not expose provider capabilities. Absence is
      // treated conservatively: accept image input, but advertise no image output.
      log("Codex provider capabilities are unavailable", {
        message: (error as Error).message
      })
    }
    providerCapabilitiesCache = {
      imageGeneration,
      webSearch,
      expiresAt: Date.now() + 30_000
    }
    return providerCapabilitiesCache
  }

  class CodexTurn implements BackendTurn {
    readonly id: string
    readonly signal: AbortSignal
    private readonly abortController = new AbortController()
    private readonly aborted: Promise<void>
    private readonly queue = new MessageQueue()
    private readonly input: StartTurnInput
    private codexTurnId: string | null = null
    private interruptPromise: Promise<void> | null = null
    private started = false
    private content = ""
    private reasoning = ""
    private readonly agentMessagePhases = new Map<string, string>()
    private nativeWebSearchEvents = 0
    private readonly images: GeneratedImage[] = []
    private readonly imageItemIds = new Set<string>()
    private lastError: string | null = null

    constructor(threadId: string, input: StartTurnInput) {
      this.id = threadId
      this.input = input
      this.signal = this.abortController.signal
      this.aborted = new Promise((resolve) => {
        this.signal.addEventListener("abort", () => resolve(), { once: true })
      })
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
        if (this.signal.aborted) {
          await this.interruptStartedTurn()
          return this.interruptedResult()
        }
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
      await this.interruptStartedTurn()
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

    private appendTextDelta(
      params: Record<string, unknown>,
      handlers: TurnStreamHandlers
    ): void {
      const delta = typeof params.delta === "string" ? params.delta : ""
      const itemId = typeof params.itemId === "string" ? params.itemId : ""
      if (this.agentMessagePhases.get(itemId) === "commentary") {
        this.reasoning += delta
        handlers.onReasoning(delta)
        return
      }
      this.content += delta
      handlers.onText(delta)
    }

    private handleStartedItem(
      item: Record<string, unknown>,
      handlers: TurnStreamHandlers
    ): void {
      if (
        item.type === "agentMessage" &&
        typeof item.id === "string" &&
        typeof item.phase === "string"
      ) {
        this.agentMessagePhases.set(item.id, item.phase)
      }
      if (item.type === "webSearch") {
        handlers.onReasoning("\nSearching the web…\n")
        this.reasoning += "\nSearching the web…\n"
      }
    }

    private handleWebSearchCompleted(
      item: Record<string, unknown>,
      handlers: TurnStreamHandlers
    ): void {
      this.nativeWebSearchEvents += 1
      const action = isRecord(item.action) ? item.action : {}
      const query =
        (typeof item.query === "string" && item.query.trim()) ||
        (typeof action.query === "string" && action.query.trim())
      const url = typeof action.url === "string" ? action.url.trim() : ""
      const trace = query
        ? `Web search: ${query}\n`
        : url
          ? `Opened web source: ${url}\n`
          : "Web search completed.\n"
      this.reasoning += trace
      handlers.onReasoning(trace)
    }

    private appendReasoningDelta(
      params: Record<string, unknown>,
      handlers: TurnStreamHandlers
    ): void {
      const delta = typeof params.delta === "string" ? params.delta : ""
      this.reasoning += delta
      handlers.onReasoning(delta)
    }

    private handleCompletedItem(
      item: Record<string, unknown>,
      handlers: TurnStreamHandlers
    ): void {
      if (
        item.type === "agentMessage" &&
        typeof item.text === "string" &&
        item.phase !== "commentary" &&
        !this.content
      ) {
        this.content = item.text
      }
      if (item.type === "webSearch") {
        this.handleWebSearchCompleted(item, handlers)
        return
      }
      if (item.type === "agentMessage" && typeof item.id === "string") {
        this.agentMessagePhases.delete(item.id)
      }
      if (item.type !== "imageGeneration" || typeof item.result !== "string")
        return

      const itemId = typeof item.id === "string" ? item.id : undefined
      if (itemId && this.imageItemIds.has(itemId)) return
      if (itemId) this.imageItemIds.add(itemId)
      const image: GeneratedImage = {
        b64Json: item.result,
        ...(typeof item.revisedPrompt === "string" && item.revisedPrompt
          ? { revisedPrompt: item.revisedPrompt }
          : {})
      }
      this.images.push(image)
      handlers.onImage?.(image)
    }

    private recordNotificationError(params: Record<string, unknown>): void {
      const error = isRecord(params.error) ? params.error : {}
      if (typeof error.message === "string") this.lastError = error.message
    }

    private appServerExitedResult(params: Record<string, unknown>): TurnResult {
      return {
        status: "failed",
        error: {
          type: "CodexAppServerExited",
          message: String(params.message ?? "Codex app-server exited")
        }
      }
    }

    private completedTurnResult(): TurnResult {
      log("Codex turn native-search evidence", {
        threadId: this.id,
        webSearchEvents: this.nativeWebSearchEvents
      })
      return {
        status: "completed",
        content: this.content,
        reasoning: this.reasoning,
        ...(this.images.length > 0 ? { images: [...this.images] } : {}),
        finish: "stop"
      }
    }

    private finishedTurnResult(turn: Record<string, unknown>): TurnResult {
      const status = String(turn.status ?? "failed")
      if (status === "completed") return this.completedTurnResult()
      const turnError = isRecord(turn.error) ? turn.error : {}
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

    private handleNotification(
      method: string,
      params: Record<string, unknown>,
      handlers: TurnStreamHandlers
    ): TurnResult | null {
      switch (method) {
        case "item/started":
          if (isRecord(params.item))
            this.handleStartedItem(params.item, handlers)
          return null
        case "item/agentMessage/delta":
          this.appendTextDelta(params, handlers)
          return null
        case "item/reasoning/summaryTextDelta":
          this.appendReasoningDelta(params, handlers)
          return null
        case "item/completed":
          if (isRecord(params.item))
            this.handleCompletedItem(params.item, handlers)
          return null
        case "error":
          this.recordNotificationError(params)
          return null
        case "olc/appServerExited":
          return this.appServerExitedResult(params)
        case "turn/completed":
          return isRecord(params.turn)
            ? this.finishedTurnResult(params.turn)
            : null
        default:
          return null
      }
    }

    private async readLeg(
      handlers: TurnStreamHandlers,
      signals: TurnRunSignals
    ): Promise<TurnResult> {
      while (true) {
        const next = await this.queue.next(
          Promise.race([signals.suspended, this.aborted])
        )
        if (next.type === "suspended") {
          return this.signal.aborted
            ? this.interruptedResult()
            : { status: "suspended" }
        }
        const params = isRecord(next.message.params) ? next.message.params : {}
        const result = this.handleNotification(
          next.message.method ?? "",
          params,
          handlers
        )
        if (result) return result
      }
    }

    private interruptStartedTurn(): Promise<void> {
      if (!this.codexTurnId) return Promise.resolve()
      if (this.interruptPromise) return this.interruptPromise
      const interrupt = client
        .request<void>("turn/interrupt", {
          threadId: this.id,
          turnId: this.codexTurnId
        })
        .catch((error) => {
          log("Codex turn interrupt failed", {
            threadId: this.id,
            message: (error as Error).message
          })
        })
      this.interruptPromise = interrupt
      return interrupt
    }

    private interruptedResult(): TurnResult {
      return {
        status: "failed",
        error: {
          type: "CodexInterrupted",
          message: "Codex turn was cancelled"
        }
      }
    }
  }

  return {
    id: "codex",
    ensureReady: () => client.start(),
    listModels: async (): Promise<CatalogModel[]> => {
      const [models, capabilities] = await Promise.all([
        loadRawModels(),
        loadProviderCapabilities()
      ])
      return [
        ...models.map((model) => mapCodexModel(model, config.BRIDGE_ENABLED)),
        ...(capabilities.imageGeneration
          ? [mapCodexImageGenerationModel()]
          : [])
      ]
    },
    resolveModel: async (requested) => {
      const models = await loadRawModels()
      const raw = typeof requested === "string" ? requested.trim() : ""
      const wanted = raw.startsWith("codex/") ? raw.slice("codex/".length) : raw
      if (wanted === "image-generation") {
        const capabilities = await loadProviderCapabilities()
        const imageModel = models.find((model) => model.isDefault) ?? models[0]
        return capabilities.imageGeneration && imageModel
          ? { providerId: "codex", modelId: imageModel.id }
          : {
              error: capabilities.imageGeneration
                ? "Codex returned no model that can drive image generation"
                : "The active Codex model provider does not support image generation"
            }
      }
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
      const requestedWebSearch = routeCodexWebSearch(
        input.tools,
        codex.WEB_SEARCH_MODE
      )
      const capabilities = requestedWebSearch.native
        ? await loadProviderCapabilities()
        : null
      const webSearch = routeCodexWebSearch(
        input.tools,
        codex.WEB_SEARCH_MODE,
        capabilities?.webSearch ?? true
      )
      log("Codex web-search route", {
        nativeWebSearch: webSearch.native,
        webSearchMode: webSearch.threadMode
      })
      const tools = config.BRIDGE_ENABLED
        ? toDynamicTools(webSearch.bridgeTools)
        : []
      const developerInstructions = [
        config.SYSTEM_PROMPT || prompt.system,
        webSearch.native
          ? "Native web search is enabled for this turn. When the user asks to search, browse, verify, look up, or use current information, use the built-in web search before answering. Do not claim you searched unless a webSearch event occurred, and cite the source URLs you used."
          : ""
      ]
        .filter(Boolean)
        .join("\n\n")
      const response = await client.request<ThreadStartResponse>(
        "thread/start",
        {
          model: input.model.modelId,
          cwd: codex.PROJECT_DIR,
          approvalPolicy: "never",
          sandbox: "read-only",
          ephemeral: true,
          serviceName: "ollama_client_olc",
          config: { web_search: webSearch.threadMode },
          ...(developerInstructions ? { developerInstructions } : {}),
          ...(tools.length > 0 ? { dynamicTools: tools } : {})
        }
      )
      const threadId = response?.thread?.id
      if (!threadId) throw new Error("Codex did not return a thread id")
      const turn = new CodexTurn(threadId, input)
      turns.set(threadId, turn)
      return turn
    },
    generateImage: async (input) => {
      await client.start()
      const capabilities = await loadProviderCapabilities()
      if (!capabilities.imageGeneration) {
        throw new BackendInputError(
          "The active Codex model provider does not support image generation."
        )
      }
      const imageInstructions = [
        config.SYSTEM_PROMPT,
        "Use the $imagegen skill to generate an image that fulfills the user's request. Invoke the built-in image_gen tool and wait for its result. Do not merely announce, describe, or promise image generation, and do not complete the turn without an image result."
      ]
        .filter(Boolean)
        .join("\n\n")
      const response = await client.request<ThreadStartResponse>(
        "thread/start",
        {
          model: input.model.modelId,
          cwd: codex.PROJECT_DIR,
          approvalPolicy: "never",
          sandbox: "read-only",
          ephemeral: true,
          serviceName: "ollama_client_olc",
          config: { web_search: "disabled" },
          developerInstructions: imageInstructions
        }
      )
      const threadId = response?.thread?.id
      if (!threadId) throw new Error("Codex did not return an image thread id")
      const turn = new CodexTurn(threadId, {
        requestId: input.requestId,
        model: input.model,
        messages: [{ role: "user", content: input.prompt }],
        tools: []
      })
      turns.set(threadId, turn)
      let abortPromise: Promise<void> | null = null
      const abort = () => {
        abortPromise ??= turn.abort()
      }
      input.signal?.addEventListener("abort", abort, { once: true })
      try {
        if (input.signal?.aborted) {
          abort()
          await abortPromise
          throw new Error("Image generation was cancelled")
        }
        const outcome = await turn.run(
          { onText: () => {}, onReasoning: () => {} },
          {
            suspended: new Promise(() => {}),
            hasUnannouncedToolCalls: () => false
          }
        )
        if (outcome.status === "failed") {
          throw new Error(outcome.error.message)
        }
        if (outcome.status === "suspended") {
          throw new Error("Codex suspended image generation unexpectedly")
        }
        if (!outcome.images?.length) {
          throw new Error("Codex completed without generating an image")
        }
        return outcome.images
      } finally {
        input.signal?.removeEventListener("abort", abort)
        if (abortPromise) await abortPromise
        await turn.dispose()
      }
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
