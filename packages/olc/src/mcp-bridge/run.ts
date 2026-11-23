/** `olc mcp`: load the config, start the bridge, and stay attached until signalled. */
import { randomBytes } from "node:crypto"
import { createMcpBridge } from "./bridge.js"
import { loadMcpConfig } from "./config.js"

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
  for (const name of Object.keys(config.servers))
    console.log(`${name}  http://${config.host}:${port}/mcp/${name}`)
  console.log(`Token: ${token}`)
  console.log("Paste the token into the extension's connector settings.")

  let stopping = false
  const stop = () => {
    if (stopping) return
    stopping = true
    void bridge.close().then(() => process.exit(0))
  }
  process.on("SIGINT", stop)
  process.on("SIGTERM", stop)
}
