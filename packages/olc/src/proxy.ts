/**
 * Composition root: configuration, the parked-call registry, the selected backend,
 * the HTTP server, and the core routes.
 *
 * The core never imports a backend directly — it receives one from the registry, so
 * a new runtime is a new adapter plus a registry entry.
 */
import { createServer, type Server } from "node:http"
import { createBackend } from "./backends/registry.js"
import type { AgentBackend, BackendContext } from "./backends/types.js"
import { type ProxyOptions, resolveConfig } from "./config.js"
import { registerChatRoutes } from "./core/chat-route.js"
import { createClientToolInvoker } from "./core/client-tools.js"
import { createRouter, sendJson } from "./core/http.js"
import { registerImageRoutes } from "./core/image-route.js"
import { registerModelRoutes } from "./core/models-route.js"
import { PendingToolCalls } from "./core/pending-tool-calls.js"
import { OLC_PUBLIC_ROUTES } from "./core/public-api-contract.js"
import { createRequestQueue } from "./core/queue.js"
import type { ProxyConfig, ProxyLogger } from "./types.js"
import { createRetryAsync } from "./util.js"

const createLogger =
  (enabled: boolean): ProxyLogger =>
  (message, details) => {
    if (!enabled) return
    if (details === undefined) console.log("[Proxy][Debug]", message)
    else console.log("[Proxy][Debug]", message, details)
  }

export const createProxy = ({
  config,
  options = {},
  fileOptions = {}
}: {
  config: ProxyConfig
  options?: ProxyOptions
  fileOptions?: ProxyOptions
}) => {
  const log = createLogger(config.DEBUG)
  const retryAsync = createRetryAsync({
    log: (message) => console.warn(message)
  })
  const pending = new PendingToolCalls({
    timeoutMs: config.BRIDGE_CALL_TIMEOUT_MS,
    log
  })
  const lock = createRequestQueue()

  const context: BackendContext = {
    config,
    options,
    fileOptions,
    log,
    retryAsync,
    callClientTool: createClientToolInvoker({ pending })
  }
  const backend: AgentBackend = createBackend(config.BACKEND, context)

  const router = createRouter({
    allowedHeaders: ["Content-Type", "Authorization", "X-OLC-Token"],
    allowedOrigins: config.ALLOWED_ORIGINS,
    onRequest: (request, response) => {
      if (!config.DEBUG) return
      const startedAt = Date.now()
      console.log(`[Proxy][HTTP] --> ${request.method} ${request.path}`, {
        contentLength: request.headers["content-length"] ?? 0,
        hasAuth: Boolean(request.headers.authorization)
      })
      response.on("finish", () => {
        console.log(
          `[Proxy][HTTP] <-- ${request.method} ${request.path} ${response.statusCode} (${Date.now() - startedAt}ms)`
        )
      })
    },
    authorize: (request) => {
      const exempt =
        request.path === "/" ||
        request.path === "/health" ||
        request.path === config.BRIDGE_PATH
      if (exempt || !config.API_KEY.trim()) return true
      return request.headers.authorization === `Bearer ${config.API_KEY}`
    },
    rateLimitKey: (request) =>
      config.API_KEY.trim() ? request.headers.authorization : undefined
  })

  router.get(OLC_PUBLIC_ROUTES.serviceInfo, (_request, response) =>
    sendJson(response, 200, {
      service: "olc",
      backend: backend.id,
      toolBridge: config.BRIDGE_ENABLED ? "enabled" : "disabled"
    })
  )
  router.get(OLC_PUBLIC_ROUTES.health, (_request, response) =>
    sendJson(response, 200, { status: "ok", backend: backend.id })
  )

  registerModelRoutes(router, { backend, log })
  registerImageRoutes(router, { backend, config, lock, log })
  const chat = registerChatRoutes(router, {
    backend,
    config,
    log,
    pending,
    lock
  })
  backend.registerRoutes?.(router)

  const server = createServer((request, response) => {
    void router.handle(request, response)
  })

  return { server, router, backend, pending, chat }
}

export interface RunningProxy {
  server: Server
  config: ProxyConfig
  backend: AgentBackend
  /** Resolves only after the listener and runtime are ready; rejects startup failure. */
  ready: Promise<void>
  shutdown: () => Promise<void>
}

export const startProxy = (
  options: ProxyOptions = {},
  fileOptions: ProxyOptions = {}
): RunningProxy => {
  const config = resolveConfig(options, fileOptions)
  const { server, backend, chat } = createProxy({
    config,
    options,
    fileOptions
  })

  // A turn can stream for the whole request timeout, and a parked tool call holds its
  // bridge request open until the client answers. Node's default request timeout
  // would cut both.
  server.requestTimeout = 0
  server.headersTimeout = 60_000

  const ready = new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(config.PORT, config.BIND_HOST, () => {
      console.log(
        `[Proxy] olc listening at http://${config.BIND_HOST}:${config.PORT} (backend: ${backend.id})`
      )
      void backend.ensureReady().then(resolve, reject)
    })
  })
  /** Embedded callers may ignore readiness; CLI callers await the original promise. */
  void ready.catch((error: unknown) =>
    console.error(
      "[Proxy] Startup failed:",
      error instanceof Error ? error.message : "Unknown failure"
    )
  )

  return {
    server,
    config,
    backend,
    ready,
    shutdown: async () => {
      await chat.shutdown()
      await backend.shutdown()
      server.close()
    }
  }
}
