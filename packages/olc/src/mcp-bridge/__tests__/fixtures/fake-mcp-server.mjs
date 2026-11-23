/**
 * Minimal stdio MCP server for bridge tests. Behaviour is driven by the
 * FAKE_MODE environment variable and by method names the tests send.
 */
import readline from "node:readline"

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)
let initializes = 0
const held = []

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line)
  process.stderr.write(`got ${message.method}\n`)
  if (message.method === undefined) return
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
