/**
 * OpenCode backend adapter.
 *
 * What is OpenCode-specific and therefore lives here: starting or adopting the
 * server, its catalog shape, the plugin that registers the client's tools, the
 * per-turn tool enable/disable map, and reading a turn from its event feed. The
 * OpenAI wire format, the parked-call registry and the suspend/resume handshake
 * belong to the core and are shared with any other backend.
 *
 * Lifecycle of a tool call here: OpenCode's agent calls a plugin tool, the plugin
 * posts to this adapter's bridge route, and the adapter hands it to
 * `context.callClientTool`. That promise stays pending — with the OpenCode turn
 * blocked on it — until the core releases it with the client's result.
 */

import { createOpencodeClient } from "@opencode-ai/sdk"
import { createOpencodeClient as createOpencodeV2Client } from "@opencode-ai/sdk/v2"
import { type Router, sendJson } from "../../core/http.js"
import {
  buildPromptParts,
  buildToolFlags,
  type PromptPart
} from "../../core/openai-wire.js"
import type { ToolResultMessage } from "../../types.js"
import { isRecord } from "../../util.js"
import {
  type AgentBackend,
  type BackendContext,
  BackendInputError,
  type BackendTurn,
  type CatalogModel,
  type StartTurnInput,
  type TurnResult,
  type TurnRunSignals,
  type TurnStreamHandlers
} from "../types.js"
import {
  collectModels,
  collectV2Models,
  mergeReasoningMetadata,
  resolveModelId,
  resolveReasoningVariant
} from "./catalog.js"
import { resolveOpencodeConfig } from "./config.js"
import { createBackendSupervisor } from "./server.js"
import { ToolManifest } from "./tool-manifest.js"
import { createTurnReader, type TurnOutcome } from "./turn-events.js"
import { routeOpencodeWebSearch } from "./web-search.js"

const TOOL_IDS_CACHE_TTL_MS = 60_000
const MODEL_CATALOG_CACHE_TTL_MS = 30_000

interface PromptBody {
  model: { providerID: string; modelID: string }
  system?: string
  agent?: string
  variant?: string
  tools: Record<string, boolean>
  parts: PromptPart[]
}

export const createOpencodeBackend = (
  context: BackendContext
): AgentBackend => {
  const { config, log, retryAsync } = context
  const opencode = resolveOpencodeConfig({
    options: context.options,
    fileOptions: context.fileOptions,
    port: config.PORT
  })
  const client = createOpencodeClient({
    baseUrl: opencode.OPENCODE_SERVER_URL
  })
  const v2Client = createOpencodeV2Client({
    baseUrl: opencode.OPENCODE_SERVER_URL
  })
  const turnReader = createTurnReader({ client, log, retryAsync })
  const manifest = new ToolManifest({
    directory: opencode.PLUGIN_DIR,
    endpoint: config.BRIDGE_ENDPOINT,
    token: config.BRIDGE_TOKEN,
    log: (message) => console.warn(`[Proxy] ${message}`)
  })
  const supervisor = createBackendSupervisor({
    config,
    opencode,
    manifest,
    log
  })
  const turns = new Map<string, OpencodeTurn>()

  let toolIdsCache: { ids: string[]; expiresAt: number } | null = null
  let catalogCache: { models: CatalogModel[]; expiresAt: number } | null = null

  const loadModels = async ({
    force = false
  } = {}): Promise<CatalogModel[]> => {
    if (!force && catalogCache && catalogCache.expiresAt > Date.now()) {
      return catalogCache.models
    }
    let models: CatalogModel[] | null = null
    try {
      const response = await retryAsync(() => v2Client.v2.model.list(), {
        label: "v2.model.list"
      })
      const data = (response as { data?: { data?: unknown } })?.data?.data
      if (Array.isArray(data)) models = collectV2Models(data)
    } catch (error) {
      log("OpenCode v2 model catalog unavailable; using legacy catalog", {
        message: (error as Error).message
      })
    }

    if (models === null) {
      const response = await retryAsync(() => client.config.providers(), {
        label: "config.providers"
      })
      const providers = (response as { data?: { providers?: unknown } })?.data
        ?.providers
      models = collectModels(providers)
    } else {
      try {
        const response = await retryAsync(() => client.config.providers(), {
          label: "config.providers.reasoning"
        })
        const providers = (response as { data?: { providers?: unknown } })?.data
          ?.providers
        models = mergeReasoningMetadata(models, collectModels(providers))
      } catch (error) {
        log("OpenCode legacy reasoning metadata unavailable", {
          message: (error as Error).message
        })
      }
    }
    catalogCache = {
      models,
      expiresAt: Date.now() + MODEL_CATALOG_CACHE_TTL_MS
    }
    return models
  }

  const loadToolIds = async ({ force = false } = {}): Promise<string[]> => {
    if (!force && toolIdsCache && toolIdsCache.expiresAt > Date.now()) {
      return toolIdsCache.ids
    }
    try {
      const response = await retryAsync(() => client.tool.ids(), {
        label: "tool.ids"
      })
      const data = (response as { data?: unknown })?.data
      const ids = Array.isArray(data) ? (data as string[]) : []
      toolIdsCache = { ids, expiresAt: Date.now() + TOOL_IDS_CACHE_TTL_MS }
      return ids
    } catch (error) {
      log("Could not read OpenCode's tool ids", {
        message: (error as Error).message
      })
      return toolIdsCache?.ids ?? []
    }
  }

  /**
   * Publish the request's tools to the bridge plugin and report which of them
   * OpenCode actually registered. A tool OpenCode never registered is dropped from
   * the enabled set, so the model is never told about a tool it cannot call.
   */
  const syncBridgeTools = async (
    tools: unknown,
    requestId: string
  ): Promise<string[]> => {
    if (!config.BRIDGE_ENABLED) return []
    const { changed, names } = manifest.sync(tools)
    if (changed) {
      log("Bridge tool manifest changed", { requestId, names })
      try {
        await retryAsync(() => client.instance.dispose(), {
          label: "instance.dispose"
        })
      } catch (error) {
        console.warn(
          `[Proxy] Could not ask OpenCode to reload its plugins: ${(error as Error).message}`
        )
      }
    }
    if (names.length === 0) return []

    const registered = await loadToolIds({ force: changed })
    const missing = manifest.missingRegistrations(registered)
    if (missing.length > 0) {
      console.warn(
        `[Proxy] OpenCode did not register client tool(s): ${missing.join(", ")}. They will not be offered to the model.`
      )
    }
    return names.filter((name) => !missing.includes(name))
  }

  /**
   * One OpenCode session, driven leg by leg.
   *
   * A leg ends either with the assistant message settled or with a parked client
   * tool call. The session survives a parked call — that is what lets the client's
   * next request continue the same turn instead of replaying it.
   */
  class OpencodeTurn implements BackendTurn {
    readonly id: string
    private readonly promptBody: PromptBody
    private prompted = false

    constructor(id: string, promptBody: PromptBody) {
      this.id = id
      this.promptBody = promptBody
    }

    async run(
      handlers: TurnStreamHandlers,
      signals: TurnRunSignals
    ): Promise<TurnResult> {
      if (!this.prompted) {
        this.prompted = true
        await retryAsync(
          () =>
            v2Client.session.promptAsync({
              sessionID: this.id,
              ...this.promptBody
            }),
          { label: "session.promptAsync" }
        )
      }
      return await this.readLeg(handlers, signals)
    }

    async resume(
      _results: ToolResultMessage[],
      handlers: TurnStreamHandlers,
      signals: TurnRunSignals
    ): Promise<TurnResult> {
      // The turn is already generating inside OpenCode, blocked on the parked tool
      // call. Nothing is re-prompted: the results are released once the event feed
      // is live again, and generation simply continues.
      return await this.readLeg(handlers, signals)
    }

    async abort(): Promise<void> {
      try {
        await client.session.abort({ path: { id: this.id } })
      } catch (error) {
        log("Session abort failed", {
          sessionId: this.id,
          message: (error as Error).message
        })
      }
    }

    async dispose(): Promise<void> {
      turns.delete(this.id)
      try {
        await client.session.delete({ path: { id: this.id } })
        log("Session cleaned up", { sessionId: this.id })
      } catch (error) {
        console.error(
          "[Proxy] Failed to clean up session:",
          (error as Error).message
        )
      }
    }

    private async readLeg(
      handlers: TurnStreamHandlers,
      signals: TurnRunSignals
    ): Promise<TurnResult> {
      const pollOptions = {
        timeoutMs: config.REQUEST_TIMEOUT_MS,
        requireFinalOrContent: true,
        onProgress: (content: string, reasoning: string) => {
          if (reasoning) handlers.onReasoning(reasoning)
          if (content) handlers.onText(content)
        },
        onPatch: (payload: unknown) => handlers.onAuxiliary?.(payload),
        isSuspended: () => suspended
      }
      let suspended = false
      void signals.suspended.then(() => {
        suspended = true
      })

      const stream = await turnReader.openEventStream(this.id, {
        timeoutMs: config.REQUEST_TIMEOUT_MS,
        firstDeltaTimeoutMs: opencode.EVENT_FIRST_DELTA_TIMEOUT_MS,
        idleTimeoutMs: opencode.EVENT_IDLE_TIMEOUT_MS,
        onDelta: (text, isReasoning) => {
          if (isReasoning) handlers.onReasoning(text)
          else handlers.onText(text)
        },
        onPatch: (payload) => handlers.onAuxiliary?.(payload),
        suspendPromise: signals.suspended
      })

      try {
        signals.releaseToolResults?.()

        const collected = await stream.done.catch(
          (error: unknown) =>
            ({ streamError: error }) as { streamError: unknown }
        )

        let final: TurnOutcome
        if ("streamError" in collected) {
          log("Falling back to polling for this turn", {
            sessionId: this.id,
            reason: `error: ${(collected.streamError as Error).message}`
          })
          final = await turnReader.pollForAssistantResponseWithRetries(
            this.id,
            pollOptions,
            opencode.POLL_TIMEOUT_RETRIES
          )
        } else if (collected.suspended) {
          return { status: "suspended" }
        } else if (collected.noData || collected.idleTimeout) {
          log("Falling back to polling for this turn", {
            sessionId: this.id,
            reason: collected.noData ? "no event data" : "idle timeout"
          })
          final = await turnReader.pollForAssistantResponseWithRetries(
            this.id,
            pollOptions,
            opencode.POLL_TIMEOUT_RETRIES
          )
        } else {
          final = collected
        }

        if (final.suspended) return { status: "suspended" }

        if (final.error && !final.content && !final.reasoning) {
          const failure = final.error
          return {
            status: "failed",
            error: {
              message:
                failure.data?.message ??
                failure.message ??
                "OpenCode provider error",
              type: failure.name ?? "OpenCodeError"
            }
          }
        }

        return {
          status: "completed",
          content: final.content,
          reasoning: final.reasoning,
          finish: final.finish ?? null
        }
      } finally {
        stream.controller.abort()
      }
    }
  }

  return {
    id: "opencode",
    ensureReady: () => supervisor.ensureReady(),
    listModels: () => loadModels(),
    resolveModel: (requested) => resolveModelId(requested, () => loadModels()),

    startTurn: async (input: StartTurnInput): Promise<BackendTurn> => {
      const { parts, system } = buildPromptParts(input.messages)
      if (parts.length === 0) {
        throw new Error(
          "messages must include at least one non-system text message"
        )
      }

      const discoveredIds = await loadToolIds()
      const webSearch = routeOpencodeWebSearch({
        tools: input.tools,
        discoveredIds,
        operatorAllowedTools: opencode.ALLOW_OPENCODE_TOOLS
      })
      const bridgeNames = await syncBridgeTools(
        webSearch.bridgeTools,
        input.requestId
      )
      const flags = buildToolFlags({
        discoveredIds,
        bridgeNames,
        allowedNativeTools: webSearch.allowedNativeTools
      })

      let variant: string | undefined
      if (input.reasoningEffort) {
        const resolved = resolveReasoningVariant(
          await loadModels(),
          input.model,
          input.reasoningEffort
        )
        if ("error" in resolved) throw new BackendInputError(resolved.error)
        variant = resolved.variant
      }

      const created = await retryAsync(() => client.session.create(), {
        label: "session.create"
      })
      const sessionId = (created as { data?: { id?: string } })?.data?.id
      if (!sessionId) throw new Error("Failed to create an OpenCode session")

      const turn = new OpencodeTurn(sessionId, {
        model: {
          providerID: input.model.providerId,
          modelID: input.model.modelId
        },
        system: config.SYSTEM_PROMPT || system || undefined,
        agent: opencode.OPENCODE_AGENT || undefined,
        ...(variant ? { variant } : {}),
        tools: flags,
        parts
      })
      turns.set(sessionId, turn)
      log("Session created", {
        requestId: input.requestId,
        sessionId,
        model: `${input.model.providerId}/${input.model.modelId}`,
        nativeWebSearch: webSearch.native,
        bridgeTools: bridgeNames,
        parts: parts.length
      })
      return turn
    },

    findTurn: (turnId) => turns.get(turnId),

    registerRoutes: (router: Router) => {
      router.post(config.BRIDGE_PATH, async (request, response) => {
        if (!config.BRIDGE_ENABLED) {
          sendJson(response, 404, { error: "The tool bridge is disabled" })
          return
        }
        if (request.headers["x-olc-token"] !== config.BRIDGE_TOKEN) {
          sendJson(response, 401, { error: "Invalid bridge token" })
          return
        }

        const body = isRecord(request.body) ? request.body : {}
        const tool = typeof body.tool === "string" ? body.tool : ""
        const turnId = typeof body.sessionID === "string" ? body.sessionID : ""
        if (!tool) {
          sendJson(response, 400, { error: "A tool name is required" })
          return
        }
        if (!turns.has(turnId)) {
          sendJson(response, 409, {
            error: `No client is attached to session ${turnId}; the tool call cannot be delivered`
          })
          return
        }

        const controller = new AbortController()
        request.raw.on("close", () => {
          if (response.writableEnded) return
          controller.abort()
        })

        try {
          const output = await context.callClientTool({
            turnId,
            tool,
            args: body.arguments,
            signal: controller.signal
          })
          sendJson(response, 200, { output })
        } catch (error) {
          sendJson(response, 200, { error: (error as Error).message })
        }
      })
    },

    shutdown: async () => {
      for (const turn of turns.values()) await turn.dispose()
      supervisor.kill()
    }
  }
}
