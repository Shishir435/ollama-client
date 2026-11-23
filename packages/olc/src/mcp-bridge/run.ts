/** `olc mcp`: load the config, start the bridge, and stay attached until signalled. */
import { randomBytes } from "node:crypto"
import { createMcpBridge } from "./bridge.js"
import { browserOrigin, formatHttpOrigin, loadMcpConfig } from "./config.js"

export async function runMcpBridge(options: {
  configPath: string
  debug: boolean
}): Promise<void> {
  const config = loadMcpConfig(options.configPath)
  const token =
    config.token ??
    (process.env.OLC_MCP_TOKEN || undefined) ??
    randomBytes(32).toString("hex")
  const bridge = createMcpBridge(config, { token, debug: options.debug })
  const { port } = await bridge.listen()
  const origin = formatHttpOrigin(config.host, port)
  for (const name of Object.keys(config.servers))
    console.log(`${name}  ${origin}/mcp/${encodeURIComponent(name)}`)
  console.log(`Token: ${token}`)
  const extensionOrigin = browserOrigin(config.host, port)
  console.log(
    extensionOrigin === undefined
      ? `Extension: ${config.host} is a zone-scoped IPv6 address, which browsers reject. Restart bound to 127.0.0.1 or ::1, then open Settings → Connectors → Connect bridge.`
      : `Extension: open Settings → Connectors → Connect bridge, URL ${extensionOrigin}, then paste the token.`
  )

  let stopping = false
  const stop = () => {
    if (stopping) return
    stopping = true
    void bridge.close().then(({ stopped, stuck }) => {
      if (stopped) process.exit(0)
      console.error(
        `Could not stop ${stuck.join(", ")}; the process may still be running.`
      )
      process.exit(1)
    })
  }
  process.on("SIGINT", stop)
  process.on("SIGTERM", stop)
}
