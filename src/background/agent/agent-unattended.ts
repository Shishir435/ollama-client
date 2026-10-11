import { isTerminalAgentStatus } from "@ollama-client/agent-runtime"
import { browser } from "@/lib/browser-api"
import { STORAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import { hasPermission } from "@/lib/permissions"
import type { AgentRunService } from "./agent-run-service"

const SESSION_KEY = STORAGE_KEYS.AGENT.UNATTENDED_BROWSER_SESSION
const STOP_MENU = "stop-browser-agent"
const WAKE_ALARM = "agent-unattended-recovery"

const updateWakeAlarm = async (working: boolean) => {
  if (!browser.alarms) return
  if (!working) {
    await browser.alarms.clear(WAKE_ALARM).catch(() => undefined)
  } else if (await hasPermission("alarms")) {
    await browser.alarms.create(WAKE_ALARM, { periodInMinutes: 1 })
  }
}

const notifyUnattended = async (id: string, completed: boolean) => {
  if (!(await hasPermission("notifications"))) return
  await browser.notifications.create(`agent-${id}`, {
    type: "basic",
    title: browser.i18n.getMessage("actionDefaultTitle"),
    message: browser.i18n.getMessage(
      completed ? "agentTaskCompleted" : "agentTaskAttention"
    ),
    iconUrl: browser.runtime.getURL("/assets/icon-128.png")
  })
}
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
  const alarm = (info: { name: string }) => {
    if (info.name !== WAKE_ALARM) return
    void ready.then(() => service.recoverUnattended()).catch(() => undefined)
  }
  browser.alarms?.onAlarm.addListener(alarm)
  browser.commands.onCommand.addListener(command)
  browser.contextMenus.onClicked.addListener(menu)
  /** Visibility updates wait for the item to exist, or the first one fails silently. */
  const menuReady = browser.contextMenus
    .remove(STOP_MENU)
    .catch(() => undefined)
    .then(() => {
      if (disposed) return
      browser.contextMenus.create({
        id: STOP_MENU,
        title: browser.i18n.getMessage("stopBrowserAgentMenu"),
        visible: false,
        contexts: ["all"]
      })
    })
    .catch((error: unknown) => {
      logger.warn("Agent stop menu unavailable", "Agent", {
        name: error instanceof Error ? error.name : typeof error
      })
    })

  let working = false
  let refresh: Promise<void> = menuReady
  /** The boundary each run last notified for; cleared once it leaves it. */
  const notified = new Map<string, string>()
  const refreshRun = (id: string, initial = false) => {
    refresh = refresh
      .then(async () => {
        const { run } = await service.snapshot(id)
        if (!disposed) {
          const active =
            run !== undefined &&
            run !== null &&
            !isTerminalAgentStatus(run.status)
          await browser.contextMenus
            .update(STOP_MENU, { visible: active })
            .catch(() => undefined)
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
          await updateWakeAlarm(working)
          const boundary =
            run?.unattended &&
            (isTerminalAgentStatus(run.status) ||
              ["paused", "awaiting_approval", "awaiting_takeover"].includes(
                run.status
              ))
          if (!boundary) notified.delete(id)
          else if (notified.get(id) !== run.status) {
            notified.set(id, run.status)
            /** A boundary already reached before this worker started was announced then. */
            if (!initial)
              await notifyUnattended(id, run.status === "completed").catch(
                () => undefined
              )
          }
        }
      })
      .catch(() => {
        working = false
      })
  }
  const unsubscribe = service.subscribe((id) => refreshRun(id))
  void ready
    .then(() => service.latestRunId())
    .then((id) => {
      if (id && !disposed) refreshRun(id, true)
    })
    .catch(() => undefined)
  /** Browser API traffic prevents idle loss only during bounded authorized work. Human waits may sleep. */
  const heartbeat = setInterval(() => {
    if (working) void browser.runtime.getPlatformInfo().catch(() => undefined)
  }, 20_000)
  return () => {
    disposed = true
    unsubscribe()
    clearInterval(heartbeat)
    browser.alarms?.onAlarm.removeListener(alarm)
    browser.commands.onCommand.removeListener(command)
    browser.contextMenus.onClicked.removeListener(menu)
  }
}
