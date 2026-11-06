#!/usr/bin/env node

/**
 * mcp-bridge — expose a stdio MCP server as a streamable-HTTP endpoint so a
 * browser extension (which cannot spawn processes) can talk to it.
 *
 * Ollama Client's MCP feature speaks streamable HTTP: one POST per JSON-RPC
 * request, response is either an SSE stream or a single JSON body. This bridge
 * returns plain JSON bodies, which the client accepts. All requests are routed
 * through ONE stdio session, so servers with document state (WordCraft) keep
 * that state across browser-chat calls.
 *
 * Usage:
 *   node mcp-bridge.js --command "C:\Programs\WordCraft\wordcraft-cli.exe" --port 9000 mcp
 *
 * Then in Ollama Client, add an MCP server at http://localhost:9000/mcp.
 */

import { spawn } from "node:child_process"
import { createServer } from "node:http"
import process from "node:process"

const argv = process.argv.slice(2)

function parseArgs(argv) {
  const out = { command: null, args: [], port: 9000 }
  let i = 0
  while (i < argv.length && argv[i].startsWith("--")) {
    const flag = argv[i]
    if (flag === "--command") {
      out.command = argv[++i]
    } else if (flag === "--port") {
      out.port = Number(argv[++i]) || 9000
    }
    i += 1
  }
  // Everything after the last flag is a child-process argument, in order.
  out.args = argv.slice(i)
  return out
}

const config = parseArgs(argv)
if (!config.command) {
  console.error(usage())
  process.exit(1)
}

function usage() {
  return [
    "mcp-bridge: expose a stdio MCP server over streamable HTTP",
    "",
    `  node mcp-bridge.js --command <cmd> [--port N] [child-arg ...]`,
    "",
    "Bridge flags must come before child arguments.",
    "Example:",
    '  node mcp-bridge.js --command "C:\\Programs\\WordCraft\\wordcraft-cli.exe" --port 9000 mcp',
    "",
    "Then add http://localhost:9000/mcp as an MCP server in Ollama Client."
  ].join("\n")
}

// --- stdio session ---------------------------------------------------------

let child = null
const pending = new Map() // request id -> { resolve, reject, timer }
let nextId = 1
let stdoutBuffer = ""
let shuttingDown = false
let restartTimer = null

function scheduleRestart() {
  if (shuttingDown) return
  clearTimeout(restartTimer)
  restartTimer = setTimeout(startChild, 1000).unref()
}

// Attach the stdio listeners to a freshly spawned child. Each child gets its
// own listener and a fresh partial-line buffer so restarted servers can reply.
function attachStdoutListeners(child) {
  stdoutBuffer = ""
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk
    const lines = stdoutBuffer.split("\n")
    stdoutBuffer = lines.pop() ?? ""
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let message
      try {
        message = JSON.parse(trimmed)
      } catch {
        console.error(
          `[mcp-bridge] dropped non-JSON stdio line: ${trimmed.slice(0, 120)}`
        )
        continue
      }
      if (message.id === undefined) continue // notification; ignore
      const entry = pending.get(message.id)
      if (!entry) continue
      clearTimeout(entry.timer)
      pending.delete(message.id)
      if ("error" in message) {
        entry.reject(new Error(message.error.message ?? "MCP error"))
      } else {
        entry.resolve(message.result)
      }
    }
  })
}

function startChild() {
  if (shuttingDown) return
  console.log(
    `[mcp-bridge] starting ${config.command} ${config.args.join(" ")}`
  )
  child = spawn(config.command, config.args, {
    stdio: ["pipe", "pipe", "pipe"]
  })
  child.stdout.setEncoding("utf8")
  attachStdoutListeners(child)
  child.stderr.on("data", (chunk) =>
    console.error(`[mcp-bridge] child stderr: ${chunk.trim()}`)
  )
  // Launch failure (bad path, permission denied, etc.). Reject in-flight work
  // and try to restart unless we are shutting down.
  child.on("error", (err) => {
    for (const [, entry] of pending) {
      clearTimeout(entry.timer)
      entry.reject(new Error(`Failed to launch MCP server: ${err.message}`))
    }
    pending.clear()
    scheduleRestart()
  })
  child.on("exit", (code, signal) => {
    const detail = signal ? `signal=${signal}` : `code=${code}`
    console.error(`[mcp-bridge] child exited (${detail}); restarting in 1s`)
    for (const [, entry] of pending) {
      clearTimeout(entry.timer)
      entry.reject(new Error("MCP server process died"))
    }
    pending.clear()
    scheduleRestart()
  })
}

function sendToChild(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`
    )
    pending.set(id, {
      resolve,
      reject,
      timer: setTimeout(() => {
        pending.delete(id)
        reject(new Error(`MCP request timed out (${method})`))
      }, 120_000)
    })
  })
}

startChild()

// --- HTTP server -----------------------------------------------------------

const MAX_BODY_BYTES = 1024 * 1024 // 1 MiB: cap MCP request bodies.

// Only the Ollama Client extension (and other extensions on this machine) may
// call local tools. Plain webpages carry an http(s) Origin and are rejected;
// non-browser clients (curl, local scripts) send no Origin and are allowed.
function isTrustedOrigin(originHeader) {
  if (!originHeader) return true
  const origin = originHeader.trim()
  return origin.startsWith("chrome-extension://")
}

const server = createServer((req, res) => {
  if (req.url === "/mcp" && !isTrustedOrigin(req.headers.origin)) {
    res.writeHead(403, { "content-type": "application/json" })
    res.end(JSON.stringify({ error: "forbidden: untrusted origin" }))
    return
  }
  if (req.method === "POST" && req.url === "/mcp") {
    let body = ""
    let tooLarge = false
    req.on("data", (chunk) => {
      body += chunk.toString()
      if (body.length > MAX_BODY_BYTES) {
        tooLarge = true
        req.destroy(new Error("request body too large"))
      }
    })
    req.on("end", async () => {
      let request = null
      try {
        if (tooLarge) throw new Error("request body too large")
        request = JSON.parse(body)
        if (!request || typeof request.method !== "string" || !request.id) {
          throw new Error("malformed JSON-RPC request")
        }
        const result = await sendToChild(request.method, request.params)
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const code = /timed out/i.test(message) ? -32601 : -32700
        res.writeHead(500, { "content-type": "application/json" })
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: request?.id ?? null,
            error: { code, message }
          })
        )
      }
    })
  } else if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ ok: true }))
  } else {
    res.writeHead(404, { "content-type": "application/json" })
    res.end(JSON.stringify({ error: "not found" }))
  }
})

server.listen(config.port, "127.0.0.1", () => {
  console.log(`[mcp-bridge] listening on http://localhost:${config.port}/mcp`)
})

function shutdown() {
  shuttingDown = true
  clearTimeout(restartTimer)
  // Reject in-flight requests so callers don't hang during shutdown.
  for (const [, entry] of pending) {
    clearTimeout(entry.timer)
    entry.reject(new Error("Bridge shutting down"))
  }
  pending.clear()
  if (child) {
    child.kill("SIGTERM")
    // Fallback in case the child ignores SIGTERM.
    setTimeout(() => {
      if (child.exitCode === undefined && child.signalCode === undefined) {
        child.kill("SIGKILL")
      }
    }, 500).unref()
  }
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 1000).unref()
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
