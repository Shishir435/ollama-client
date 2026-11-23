/**
 * Minimal stdio MCP server for bridge tests. Behaviour is driven by the
 * FAKE_MODE environment variable and by method names the tests send.
 */
import { spawn } from "node:child_process"
import readline from "node:readline"

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)
if (process.env.FAKE_MODE === "ignore-term") process.on("SIGTERM", () => {})
let initializes = 0
const held = []
const waiting = []

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line)
  process.stderr.write(`got ${message.method}\n`)
  if (message.method === undefined) return
  if (message.method === "notifications/cancelled") {
    process.stderr.write(`cancelled ${JSON.stringify(message.params)}\n`)
    const index = waiting.indexOf(message.params?.requestId)
    if (index >= 0) {
      const [id] = waiting.splice(index, 1)
      send({
        jsonrpc: "2.0",
        id,
        error: { code: -32800, message: "cancelled" }
      })
    }
  }
  if (message.id === undefined) return
  switch (message.method) {
    case "initialize":
      initializes += 1
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2025-03-26",
          serverInfo: { n: initializes }
        }
      })
      return
    case "crash":
      process.exit(3)
      return
    case "noise":
      process.stdout.write("not json\n")
      send({ jsonrpc: "2.0", id: 999, method: "sampling/createMessage" })
      send({ jsonrpc: "2.0", id: message.id, result: { ok: true } })
      return
    case "hold":
      held.push(message.id)
      if (held.length === 2) {
        /** Answer in reverse order to prove ids are matched, not ordered. */
        for (const id of held.reverse())
          send({ jsonrpc: "2.0", id, result: { echoed: id } })
      }
      return
    case "pid":
      send({ jsonrpc: "2.0", id: message.id, result: { pid: process.pid } })
      return
    case "bye":
      /** Answer and exit at once: stdout may still be unread when `exit` fires. */
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { bye: true } })}\n`,
        () => process.exit(0)
      )
      return
    case "orphan":
      /** Exit while a descendant still holds the inherited stdout open. */
      spawn(process.execPath, ["-e", "setTimeout(() => {}, 2500)"], {
        stdio: ["ignore", "inherit", "inherit"]
      }).unref()
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { orphan: true } })}\n`,
        () => process.exit(0)
      )
      return
    case "cancellable":
      /** Held until a matching cancellation or a `release` request. */
      waiting.push(message.id)
      return
    case "release":
      for (const id of waiting.splice(0))
        send({ jsonrpc: "2.0", id, result: { released: true } })
      send({ jsonrpc: "2.0", id: message.id, result: { ok: true } })
      return
    case "never":
      return
    default:
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: { method: message.method }
      })
  }
})
