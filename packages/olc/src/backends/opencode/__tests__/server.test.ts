import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, it, vi } from "vitest"
import { resolveConfig } from "../../../config.js"
import { resolveOpencodeConfig } from "../config.js"
import { createBackendSupervisor } from "../server.js"
import type { ToolManifest } from "../tool-manifest.js"

let running: Server | null = null

/** An OpenCode server that is already up, as an operator's own would be. */
const startHealthyServer = async (): Promise<string> => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" })
    response.end(JSON.stringify({ status: "ok" }))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  running = server
  const { port } = server.address() as AddressInfo
  return `http://127.0.0.1:${port}`
}

afterEach(async () => {
  if (running) {
    await new Promise<void>((resolve) => running?.close(() => resolve()))
    running = null
  }
})

const fakeManifest = () => {
  const install = vi.fn(() => ({ linked: true }))
  return {
    manifest: {
      install,
      pluginEntry: "file:///tmp/olc-bridge/port-8084/bridge.ts",
      directory: "/tmp/olc-bridge/port-8084"
    } as unknown as ToolManifest,
    install
  }
}

describe("createBackendSupervisor", () => {
  /**
   * Installing only on the spawn path left an adopted server's proxy with a
   * manifest that was never written, so the tools it thought it had published
   * existed only in memory.
   */
  it("installs the plugin even when it adopts a running server", async () => {
    const serverUrl = await startHealthyServer()
    const { manifest, install } = fakeManifest()
    const supervisor = createBackendSupervisor({
      config: resolveConfig(),
      opencode: resolveOpencodeConfig({
        options: { OPENCODE_SERVER_URL: serverUrl },
        port: 8084
      }),
      manifest,
      log: () => {}
    })

    await supervisor.ensureReady()

    expect(install).toHaveBeenCalledTimes(1)
    expect(supervisor.pluginLinked).toBe(true)
    // Nothing told this server to load that plugin, so its registrations are
    // somebody else's and the adapter must not advertise them.
    expect(supervisor.managedServer).toBe(false)

    await supervisor.ensureReady()
    expect(install).toHaveBeenCalledTimes(1)
  })

  it("installs nothing when the bridge is disabled", async () => {
    const serverUrl = await startHealthyServer()
    const { manifest, install } = fakeManifest()
    const supervisor = createBackendSupervisor({
      config: { ...resolveConfig(), BRIDGE_ENABLED: false },
      opencode: resolveOpencodeConfig({
        options: { OPENCODE_SERVER_URL: serverUrl },
        port: 8084
      }),
      manifest,
      log: () => {}
    })

    await supervisor.ensureReady()

    expect(install).not.toHaveBeenCalled()
    expect(supervisor.pluginLinked).toBe(false)
    expect(supervisor.managedServer).toBe(false)
  })
})
