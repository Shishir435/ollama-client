import { isTerminalAgentStatus } from "@ollama-client/agent-runtime"
import { browser } from "@/lib/browser-api"
import { logger } from "@/lib/logger"
import type { AgentRunService } from "./agent-run-service"

const SESSION_KEY = "agent-unattended-browser-session"
const STOP_MENU = "stop-browser-agent"
let session: Promise<string> | undefined

/** A worker restart keeps this nonce; browser shutdown clears it and cannot reuse tab consent. */
export const agentBrowserSessionId = (): Promise<string> => {
  session ??= (async () => {
    if (!browser.storage.session)
      throw new Error("Unattended session storage unavailable")
    const stored = (await browser.storage.session.get(SESSION_KEY))[SESSION_KEY]
    if (typeof stored === "string" && stored.length > 0) return stored
    const id = crypto.randomUUID()
    await browser.storage.session.set({ [SESSION_KEY]: id })
    return id
  })().catch((error: unknown) => {
    session = undefined
    throw error
  })
  return session
}

/** Native stop controls stay available after the last panel disappears. */
export const registerAgentUnattendedControls = (
  service: AgentRunService,
  ready: Promise<void>
): (() => void) => {
  let disposed = false
  const stop = async () => {
    try {
      await ready
      const id = await service.latestRunId()
      if (id) await service.stop(id)
    } catch (error) {
      logger.warn("Agent toolbar stop failed", "Agent", {
        name: error instanceof Error ? error.name : typeof error
      })
    }
  }
  const command = (name: string) => {
    if (name === "stop-agent") void stop()
  }
  const menu = (info: { menuItemId: string | number }) => {
    if (info.menuItemId === STOP_MENU) void stop()
  }
  browser.commands.onCommand.addListener(command)
  browser.contextMenus.onClicked.addListener(menu)
  void browser.contextMenus
    .remove(STOP_MENU)
    .catch(() => undefined)
    .then(() => {
      if (disposed) return
      browser.contextMenus.create({
        id: STOP_MENU,
        title: "Stop browser agent",
        contexts: ["all"]
      })
    })
    .catch((error: unknown) => {
      logger.warn("Agent stop menu unavailable", "Agent", {
        name: error instanceof Error ? error.name : typeof error
      })
    })

  let working = false
  let refresh = Promise.resolve()
  const unsubscribe = service.subscribe((id) => {
    refresh = refresh
      .then(async () => {
        const { run } = await service.snapshot(id)
        if (!disposed)
          working = Boolean(
            run?.unattended &&
              !isTerminalAgentStatus(run.status) &&
              ![
                "paused",
                "pause_requested",
                "cancelling",
                "awaiting_approval",
                "awaiting_takeover"
              ].includes(run.status)
          )
      })
      .catch(() => {
        working = false
      })
  })
  /** Browser API traffic prevents idle loss only during bounded authorized work. Human waits may sleep. */
  const heartbeat = setInterval(() => {
    if (working) void browser.runtime.getPlatformInfo().catch(() => undefined)
  }, 20_000)
  return () => {
    disposed = true
    unsubscribe()
    clearInterval(heartbeat)
    browser.commands.onCommand.removeListener(command)
    browser.contextMenus.onClicked.removeListener(menu)
  }
}
