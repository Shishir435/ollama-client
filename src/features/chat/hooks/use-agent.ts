import { useStorage } from "@plasmohq/storage/hook"
import { useCallback, useEffect, useRef, useState } from "react"
import type {
  AgentStatus,
  AgentStep,
  AgentStreamMessage,
  AgentWaitContext
} from "@/lib/agent/types"
import { MESSAGE_KEYS, STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type { SelectedModelRef } from "@/types"

/** After this many ms with no update, show "slow" warning */
const SLOW_THRESHOLD_MS = 15_000
/** After this many ms with no update, auto-stop and show timeout error */
const HUNG_THRESHOLD_MS = 90_000

export interface UseAgentReturn {
  agentModeEnabled: boolean
  visionModeEnabled: boolean
  autoRepeatEnabled: boolean
  isAgentRunning: boolean
  agentSteps: AgentStep[]
  agentStatus: AgentStatus
  agentFinalMessage: string | undefined
  elapsedMs: number
  isSlow: boolean
  waitContext?: AgentWaitContext
  agentMode: "tool-calling" | "json-fallback" | undefined
  runAgentTask: (task: string) => Promise<void>
  stopAgent: () => void
}

const resolveAgentTabId = async (): Promise<number | undefined> => {
  try {
    const activeTabs = await chrome.tabs.query({ active: true })
    const bestActiveWebTab = activeTabs
      .filter(
        (tab) =>
          typeof tab.id === "number" &&
          !!tab.url &&
          !/^chrome-extension:/i.test(tab.url)
      )
      .sort(
        (a, b) =>
          ((b as any).lastAccessed || 0) - ((a as any).lastAccessed || 0)
      )[0]

    if (bestActiveWebTab?.id) return bestActiveWebTab.id

    const allTabs = await chrome.tabs.query({})
    const bestRecentWebTab = allTabs
      .filter(
        (tab) =>
          typeof tab.id === "number" &&
          !!tab.url &&
          !/^chrome-extension:/i.test(tab.url)
      )
      .sort(
        (a, b) =>
          ((b as any).lastAccessed || 0) - ((a as any).lastAccessed || 0)
      )[0]

    return bestRecentWebTab?.id
  } catch {
    return undefined
  }
}

export const useAgent = (): UseAgentReturn => {
  const [agentModeEnabled] = useStorage<boolean>(
    { key: STORAGE_KEYS.AGENT.MODE_ENABLED, instance: plasmoGlobalStorage },
    false
  )
  const [visionModeEnabled] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.AGENT.VISION_MODE_ENABLED,
      instance: plasmoGlobalStorage
    },
    false
  )
  const [autoRepeatEnabled] = useStorage<boolean>(
    { key: "agent-auto-repeat-enabled", instance: plasmoGlobalStorage },
    false
  )
  const [selectedModelRef] = useStorage<SelectedModelRef | null>(
    {
      key: STORAGE_KEYS.PROVIDER.SELECTED_MODEL_REF,
      instance: plasmoGlobalStorage
    },
    null
  )
  const [selectedModel] = useStorage<string>(
    {
      key: STORAGE_KEYS.PROVIDER.SELECTED_MODEL,
      instance: plasmoGlobalStorage
    },
    ""
  )

  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([])
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("idle")
  const [agentFinalMessage, setAgentFinalMessage] = useState<
    string | undefined
  >()
  const [elapsedMs, setElapsedMs] = useState(0)
  const [isSlow, setIsSlow] = useState(false)
  const [waitContext, setWaitContext] = useState<AgentWaitContext | undefined>()
  const [agentMode, setAgentMode] = useState<
    "tool-calling" | "json-fallback" | undefined
  >()

  const portRef = useRef<chrome.runtime.Port | null>(null)
  const activeRunIdRef = useRef(0)
  const stopRequestedRef = useRef(false)
  const terminalStatusRef = useRef<AgentStatus>("idle")
  const waitContextRef = useRef<AgentWaitContext | undefined>(undefined)
  const lastActivityRef = useRef<number>(0)
  const lastProgressMessageRef = useRef<string | undefined>(undefined)
  const startTimeRef = useRef<number>(0)
  const lastUpdateRef = useRef<number>(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const hungTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Tick every second while running to update elapsed display and detect hangs
  const startTimers = useCallback(() => {
    const now = Date.now()
    startTimeRef.current = now
    lastUpdateRef.current = now
    lastActivityRef.current = now
    setElapsedMs(0)
    setIsSlow(false)

    timerRef.current = setInterval(() => {
      const now = Date.now()
      setElapsedMs(now - startTimeRef.current)
      const msSinceUpdate = now - lastUpdateRef.current
      setIsSlow(msSinceUpdate > SLOW_THRESHOLD_MS && !waitContextRef.current)
      const msSinceActivity = now - lastActivityRef.current

      if (msSinceActivity > HUNG_THRESHOLD_MS) {
        if (timerRef.current) {
          clearInterval(timerRef.current)
          timerRef.current = null
        }
        if (hungTimerRef.current) {
          clearTimeout(hungTimerRef.current)
          hungTimerRef.current = null
        }
        setAgentStatus("error")
        terminalStatusRef.current = "error"
        setAgentFinalMessage(
          "Request timed out after 90 seconds with no response. " +
            "Ollama may be offline or the model is unresponsive. " +
            "Try: ollama run <model-name> in a terminal first."
        )
        portRef.current?.disconnect()
        portRef.current = null
      }
    }, 1000)
  }, [])

  const stopTimers = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (hungTimerRef.current) {
      clearTimeout(hungTimerRef.current)
      hungTimerRef.current = null
    }
    waitContextRef.current = undefined
    setWaitContext(undefined)
    setIsSlow(false)
  }, [])

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopTimers()
      portRef.current?.disconnect()
    }
  }, [stopTimers])

  const stopAgent = useCallback(() => {
    stopRequestedRef.current = true
    if (portRef.current) {
      try {
        portRef.current.postMessage({ type: MESSAGE_KEYS.AGENT.STOP })
      } catch {
        // port may already be closing
      }
    }
    stopTimers()
    setAgentStatus("stopped")
    terminalStatusRef.current = "stopped"
    setAgentFinalMessage("Agent stopped by user.")
  }, [stopTimers])

  const runAgentTask = useCallback(
    async (task: string) => {
      const model = selectedModelRef?.modelId || selectedModel
      if (!model) {
        console.warn("[Agent] No model selected")
        return
      }

      const previousPort = portRef.current
      portRef.current = null
      if (previousPort) {
        try {
          previousPort.disconnect()
        } catch {
          // ignore stale port cleanup failures
        }
      }

      const runId = ++activeRunIdRef.current
      stopRequestedRef.current = false

      // Reset all state
      setAgentSteps([])
      setAgentFinalMessage(undefined)
      setAgentStatus("running")
      terminalStatusRef.current = "running"
      waitContextRef.current = undefined
      lastActivityRef.current = Date.now()
      lastProgressMessageRef.current = undefined
      setWaitContext(undefined)
      setAgentMode(undefined)
      startTimers()

      // Open port to background agent handler
      const port = chrome.runtime.connect({
        name: MESSAGE_KEYS.AGENT.EXECUTE_TASK
      })
      portRef.current = port

      port.onMessage.addListener((msg: AgentStreamMessage) => {
        if (activeRunIdRef.current !== runId) return

        switch (msg.type) {
          case "step":
            lastUpdateRef.current = Date.now()
            lastActivityRef.current = Date.now()
            lastProgressMessageRef.current = msg.step?.result?.message
            waitContextRef.current = undefined
            setWaitContext(undefined)
            setIsSlow(false)
            if (msg.step) {
              setAgentSteps((prev) => {
                const idx = prev.findIndex(
                  (s) => s.stepNumber === msg.step!.stepNumber
                )
                if (idx >= 0) {
                  const updated = [...prev]
                  updated[idx] = msg.step!
                  return updated
                }
                return [...prev, msg.step!]
              })
            }
            break

          case "done":
            lastUpdateRef.current = Date.now()
            lastActivityRef.current = Date.now()
            lastProgressMessageRef.current = msg.message
            waitContextRef.current = undefined
            setWaitContext(undefined)
            setIsSlow(false)
            stopTimers()
            setAgentStatus(msg.status || "done")
            terminalStatusRef.current = msg.status || "done"
            setAgentFinalMessage(msg.message)
            if (portRef.current === port) {
              portRef.current = null
            }
            try {
              port.disconnect()
            } catch {
              // ignore disconnect races
            }
            break

          case "error":
            lastUpdateRef.current = Date.now()
            lastActivityRef.current = Date.now()
            lastProgressMessageRef.current = msg.error
            waitContextRef.current = undefined
            setWaitContext(undefined)
            setIsSlow(false)
            stopTimers()
            setAgentStatus("error")
            terminalStatusRef.current = "error"
            setAgentFinalMessage(msg.error || "Unknown error occurred.")
            if (portRef.current === port) {
              portRef.current = null
            }
            try {
              port.disconnect()
            } catch {
              // ignore disconnect races
            }
            break

          case "status":
            lastActivityRef.current = Date.now()
            waitContextRef.current = msg.waitContext
            setWaitContext(msg.waitContext)
            if (!msg.heartbeat) {
              lastUpdateRef.current = Date.now()
              setIsSlow(false)
            }
            if (msg.message && !msg.heartbeat) {
              lastProgressMessageRef.current = msg.message
            }
            if (msg.status) setAgentStatus(msg.status)
            if (msg.mode) setAgentMode(msg.mode)
            break
        }
      })

      port.onDisconnect.addListener(() => {
        if (portRef.current === port) {
          portRef.current = null
        }
        if (activeRunIdRef.current !== runId) return

        stopTimers()
        if (terminalStatusRef.current !== "running") return

        const disconnectStatus = stopRequestedRef.current ? "stopped" : "error"
        const msSinceProgress =
          Date.now() -
          (lastUpdateRef.current || startTimeRef.current || Date.now())
        const wasWaitingOnModel = msSinceProgress >= SLOW_THRESHOLD_MS
        terminalStatusRef.current = disconnectStatus
        setAgentStatus((prev) => {
          if (prev !== "running") return prev
          return disconnectStatus
        })
        setAgentFinalMessage((prev) => {
          if (prev) return prev
          return stopRequestedRef.current
            ? "Agent stopped by user."
            : wasWaitingOnModel
              ? "Agent connection dropped while waiting for the local model. The model may be too slow or overloaded for this task. Try a faster model, disable Vision Mode, or simplify the request."
              : lastProgressMessageRef.current
                ? `Agent disconnected unexpectedly after: ${lastProgressMessageRef.current}`
                : "Agent disconnected unexpectedly. Retry the task."
        })
      })

      const tabId = await resolveAgentTabId()

      // Start the task
      port.postMessage({
        type: MESSAGE_KEYS.AGENT.EXECUTE_TASK,
        payload: {
          task,
          model,
          providerId: selectedModelRef?.providerId,
          tabId,
          maxSteps: 15,
          visionMode: visionModeEnabled,
          autoRepeat: autoRepeatEnabled
        }
      })
    },
    [
      selectedModel,
      selectedModelRef,
      startTimers,
      stopTimers,
      visionModeEnabled,
      autoRepeatEnabled
    ]
  )

  return {
    agentModeEnabled,
    visionModeEnabled,
    autoRepeatEnabled,
    isAgentRunning: agentStatus === "running",
    agentSteps,
    agentStatus,
    agentFinalMessage,
    elapsedMs,
    isSlow,
    waitContext,
    agentMode,
    runAgentTask,
    stopAgent
  }
}
