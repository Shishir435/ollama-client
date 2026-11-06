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
 *   node mcp-bridge.js --command "C:\Programs\WordCraft\wordcraft-cli.exe" mcp [--port 9000]
 *
 * Then in Ollama Client, add an MCP server at http://localhost:9000/mcp.
 */

import { createServer } from "node:http"
import { spawn } from "node:child_process"
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
    "Example:",
    '  node mcp-bridge.js --command "C:\\Programs\\WordCraft\\wordcraft-cli.exe" mcp --port 9000',
    "",
    "Then add http://localhost:9000/mcp as an MCP server in Ollama Client."
  ].join("\n")
}

// --- stdio session ---------------------------------------------------------

let child = null
const pending = new Map() // request id -> { resolve, reject, timer }
let nextId = 1
let stdoutBuffer = ""

function startChild() {
  console.log(`[mcp-bridge] starting ${config.command} ${config.args.join(" ")}`)
  child = spawn(config.command, config.args, { stdio: ["pipe", "pipe", "pipe"] })
  child.stdout.setEncoding("utf8")
  child.stderr.on("data", (chunk) => console.error(`[mcp-bridge] child stderr: ${chunk.trim()}`))
  child.on("exit", (code, signal) => {
    const detail = signal ? `signal=${signal}` : `code=${code}`
    console.error(`[mcp-bridge] child exited (${detail}); restarting in 1s`)
    for (const [, entry] of pending) {
      clearTimeout(entry.timer)
      entry.reject(new Error("MCP server process died"))
    }
    pending.clear()
    setTimeout(startChild, 1000).unref()
  })
}

function sendToChild(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n")
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
      console.error(`[mcp-bridge] dropped non-JSON stdio line: ${trimmed.slice(0, 120)}`)
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

// --- HTTP server -----------------------------------------------------------

const server = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/mcp") {
    let body = ""
    req.on("data", (chunk) => (body += chunk))
    req.on("end", async () => {
      try {
        const request = JSON.parse(body)
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
        res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id ?? null, error: { code, message } }))
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
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 500).unref()
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
