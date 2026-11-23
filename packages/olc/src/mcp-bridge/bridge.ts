/**
 * Streamable-HTTP front end for stdio MCP servers.
 *
 * The browser extension cannot spawn processes, so this loopback server owns the
 * children and speaks the MCP transport on their behalf. Each configured server
 * is one stdio session shared by every client; requests are multiplexed by
 * rewriting JSON-RPC ids, and the `initialize` handshake is answered from a cache
 * so a restarted extension worker does not disturb the child.
 */
import { createHash, timingSafeEqual } from "node:crypto"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { OLC_VERSION } from "../version.js"
import {
  ChildError,
  type JsonRpcId,
  type JsonRpcMessage,
  StdioChild
} from "./child.js"
import type { McpBridgeConfig } from "./config.js"

export const MAX_BODY_BYTES = 4 * 1024 * 1024
export const REQUEST_TIMEOUT_MS = 120_000
const EXTENSION_ORIGINS = ["chrome-extension://", "moz-extension://"]

export interface McpBridgeOptions {
  token: string
  debug?: boolean
  /** Receives diagnostic lines; defaults to the process's stderr. */
  log?: (line: string) => void
  requestTimeoutMs?: number
}

export interface McpBridge {
  server: http.Server
  listen: () => Promise<{ port: number }>
  close: () => Promise<void>
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: number,
    message: string
  ) {
    super(message)
  }
}

const digest = (value: string) => createHash("sha256").update(value).digest()

/** Constant-time on both content and length, via fixed-size digests. */
function tokenMatches(header: string | undefined, token: string): boolean {
  const match = /^Bearer (.+)$/.exec(header ?? "")
  const presented = match?.[1] ?? ""
  return timingSafeEqual(digest(presented), digest(token)) && match !== null
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    ...headers
  })
  res.end(payload)
}

const rpcError = (id: JsonRpcId | null, code: number, message: string) => ({
  jsonrpc: "2.0" as const,
  id,
  error: { code, message }
})

export function createMcpBridge(
  config: McpBridgeConfig,
  options: McpBridgeOptions
): McpBridge {
  const debug = options.debug === true
  const log =
    options.log ?? ((line: string) => void process.stderr.write(`${line}\n`))
  const timeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS
  const children = new Map<string, StdioChild>()
  for (const [name, spec] of Object.entries(config.servers))
    children.set(name, new StdioChild({ name, spec, timeoutMs, debug, log }))

  /** Reads the body, refusing anything over the cap without buffering it. */
  const readBody = (req: http.IncomingMessage): Promise<string> =>
    new Promise((resolve, reject) => {
      const declared = Number(req.headers["content-length"])
      if (declared > MAX_BODY_BYTES) {
        reject(new HttpError(413, -32600, "Request body too large"))
        return
      }
      const chunks: Buffer[] = []
      let size = 0
      req.on("data", (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_BODY_BYTES) {
          chunks.length = 0
          reject(new HttpError(413, -32600, "Request body too large"))
          return
        }
        if (size <= MAX_BODY_BYTES) chunks.push(chunk)
      })
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
      req.on("error", reject)
    })

  const sessionHeaders = (child: StdioChild): Record<string, string> =>
    child.sessionId ? { "Mcp-Session-Id": child.sessionId } : {}

  /** Restore the client's id on a child's reply. */
  const reply = (
    res: http.ServerResponse,
    child: StdioChild,
    id: JsonRpcId,
    response: JsonRpcMessage
  ) => {
    const { id: _bridgeId, ...rest } = response
    sendJson(res, 200, { ...rest, id }, sessionHeaders(child))
  }

  const handlePost = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    child: StdioChild
  ) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(await readBody(req))
    } catch (error) {
      if (error instanceof HttpError) throw error
      throw new HttpError(400, -32700, "Parse error")
    }
    if (Array.isArray(parsed))
      throw new HttpError(400, -32600, "Batch requests are not supported")
    if (typeof parsed !== "object" || parsed === null)
      throw new HttpError(400, -32600, "Expected a JSON-RPC message")
    const message = parsed as JsonRpcMessage
    if (message.jsonrpc !== "2.0")
      throw new HttpError(400, -32600, 'Expected "jsonrpc": "2.0"')
    if (
      message.id !== undefined &&
      typeof message.id !== "string" &&
      typeof message.id !== "number"
    )
      throw new HttpError(400, -32600, "Invalid request id")

    const claimed = req.headers["mcp-session-id"]
    if (claimed !== undefined && claimed !== child.sessionId)
      throw new HttpError(404, -32001, "Session not found")

    /** A client's reply to a server request: the bridge never sends any. */
    if (message.method === undefined) {
      if (message.result === undefined && message.error === undefined)
        throw new HttpError(400, -32600, "Missing method")
      res.writeHead(202, sessionHeaders(child)).end()
      return
    }

    child.ensureStarted()
    const clientId = message.id
    if (clientId === undefined) {
      if (message.method === "notifications/initialized") {
        if (child.initializedForwarded) {
          res.writeHead(202, sessionHeaders(child)).end()
          return
        }
        child.initializedForwarded = true
      }
      if (message.method === "notifications/cancelled") child.cancel(message)
      else child.notify(message)
      res.writeHead(202, sessionHeaders(child)).end()
      return
    }

    try {
      if (message.method === "initialize") {
        const cached = child.initialize
        const pending = cached ?? child.request(message)
        if (!cached) child.initialize = pending
        try {
          const response = await pending
          if (response.error && child.initialize === pending)
            child.initialize = undefined
          reply(res, child, clientId, response)
        } catch (error) {
          if (child.initialize === pending) child.initialize = undefined
          throw error
        }
        return
      }
      reply(res, child, clientId, await child.request(message))
    } catch (error) {
      if (!(error instanceof ChildError)) throw error
      const status = error.kind === "timeout" ? 504 : 502
      sendJson(
        res,
        status,
        rpcError(clientId, -32000, error.message),
        sessionHeaders(child)
      )
    }
  }

  const handle = async (
    req: http.IncomingMessage,
    res: http.ServerResponse
  ) => {
    const url = new URL(req.url ?? "/", "http://localhost")
    if (url.pathname === "/health") {
      if (req.method !== "GET" && req.method !== "HEAD")
        throw new HttpError(405, -32000, "Method not allowed")
      sendJson(res, 200, { ok: true })
      return
    }
    const route = /^\/mcp\/([^/]+)$/.exec(url.pathname)
    const isServers = url.pathname === "/servers"
    if (!route && !isServers) throw new HttpError(404, -32000, "Not found")

    if (!tokenMatches(req.headers.authorization, options.token))
      throw new HttpError(401, -32000, "Unauthorized")
    const origin = req.headers.origin
    if (
      origin !== undefined &&
      !EXTENSION_ORIGINS.some((prefix) => origin.startsWith(prefix))
    )
      throw new HttpError(403, -32000, "Origin not allowed")

    if (isServers) {
      if (req.method !== "GET") {
        res.setHeader("Allow", "GET")
        throw new HttpError(405, -32000, "Method not allowed")
      }
      sendJson(res, 200, {
        bridge: "olc-mcp",
        version: OLC_VERSION,
        servers: [...children.keys()].map((name) => ({
          name,
          path: `/mcp/${encodeURIComponent(name)}`
        }))
      })
      return
    }

    let name: string
    try {
      name = decodeURIComponent((route as RegExpExecArray)[1] as string)
    } catch {
      throw new HttpError(404, -32000, "Unknown MCP server")
    }
    const child = children.get(name)
    if (!child) throw new HttpError(404, -32000, "Unknown MCP server")

    if (req.method === "POST") return handlePost(req, res, child)
    if (req.method === "DELETE") {
      res.writeHead(200, sessionHeaders(child)).end()
      return
    }
    res.setHeader("Allow", "POST, DELETE")
    throw new HttpError(405, -32000, "Method not allowed")
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (res.headersSent) {
        res.destroy()
        return
      }
      if (error instanceof HttpError) {
        const headers: Record<string, string> =
          error.status === 413 ? { Connection: "close" } : {}
        const allow = res.getHeader("Allow")
        if (typeof allow === "string") headers.Allow = allow
        sendJson(
          res,
          error.status,
          rpcError(null, error.code, error.message),
          headers
        )
        if (error.status === 413) {
          /** Let the sender see the answer before the connection is cut. */
          req.resume()
          res.on("finish", () => setTimeout(() => req.destroy(), 1000).unref())
        }
        return
      }
      log(
        `[mcp] internal error: ${error instanceof Error ? error.message : String(error)}`
      )
      sendJson(res, 500, rpcError(null, -32603, "Internal error"))
    })
  })
  server.on("clientError", (_error, socket) => socket.destroy())

  return {
    server,
    listen: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject)
        server.listen(config.port, config.host, () => {
          server.off("error", reject)
          resolve({ port: (server.address() as AddressInfo).port })
        })
      }),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections()
        const stopped = Promise.all(
          [...children.values()].map((child) => child.stop())
        )
        server.close(() => void stopped.then(() => resolve()))
      })
  }
}
