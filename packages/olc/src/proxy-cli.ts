/** CLI-owned proxy startup, signal handling, and detached-child handoff. */
import type { ProxyLaunchRequest } from "./detached-proxy.js"
import { endpoint } from "./ollama/config.js"
import { type RunningProxy, startProxy } from "./proxy.js"
import { isRecord } from "./util.js"

/** Keep a foreground proxy attached; a detached child outlives its launcher only after acceptance. */
export async function serveProxy(
  request: ProxyLaunchRequest,
  child = false
): Promise<void> {
  let proxy: RunningProxy | undefined
  let closing = false
  let accepted = false
  let ready = false
  const shutdown = (code: number) => {
    if (closing) return
    closing = true
    void (proxy?.shutdown() ?? Promise.resolve())
      .catch((error: unknown) =>
        console.error("[Shutdown] Cleanup failed:", error)
      )
      .finally(() => process.exit(code))
  }
  const disconnected = () => {
    if (!accepted) shutdown(1)
  }
  const receive = (message: unknown) => {
    if (
      isRecord(message) &&
      message.type === "olc:detach" &&
      ready &&
      !closing
    ) {
      accepted = true
      process.off("disconnect", disconnected)
      process.off("message", receive)
      process.send?.({ type: "olc:detached" }, (error: Error | null) => {
        if (error) shutdown(1)
        else if (process.connected) process.disconnect()
      })
    }
  }
  process.once("SIGINT", () => shutdown(130))
  process.once("SIGTERM", () => shutdown(143))
  process.on("uncaughtException", (error) => {
    console.error("[Fatal]", error)
    shutdown(1)
  })
  process.on("unhandledRejection", (error) => {
    console.error("[Fatal]", error)
    shutdown(1)
  })
  if (child) {
    process.on("disconnect", disconnected)
    process.on("message", receive)
    if (!process.connected) {
      shutdown(1)
      return
    }
  }
  try {
    proxy = startProxy(request.options, request.fileOptions)
    const { config } = proxy
    console.log(
      `[Config] backend=${config.BACKEND} host=${config.BIND_HOST} port=${config.PORT} pid=${process.pid}`
    )
    console.log(
      `[Config] auth=${config.API_KEY ? "configured" : "none"} debug=${config.DEBUG} bridge=${config.BRIDGE_ENABLED}`
    )
    console.log(
      `[Config] allowed origins: ${config.ALLOWED_ORIGINS.join(", ")}`
    )
    await proxy.ready
    if (closing) return
    const address = proxy.server.address()
    const url = endpoint(
      config.BIND_HOST,
      typeof address === "object" && address ? address.port : config.PORT
    )
    ready = true
    if (child)
      process.send?.({ type: "olc:ready", url }, (error: Error | null) => {
        if (error) shutdown(1)
      })
    else console.log(`Ready: ${url} (foreground; Ctrl-C stops this proxy)`)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown failure"
    console.error("[Fatal] Failed to start proxy:", message)
    if (child && process.connected)
      process.send?.({ type: "olc:error", message }, () => shutdown(1))
    else shutdown(1)
  }
}
