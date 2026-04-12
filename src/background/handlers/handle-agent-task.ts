import { ActionExecutor } from "@/lib/agent/action-executor"
import type { AgentBrowserSession } from "@/lib/agent/browser-automation"
import {
  captureVisionContext,
  ensureContentScript,
  resolveTargetTabId,
  wait
} from "@/lib/agent/browser-automation"
import { ContextManager } from "@/lib/agent/context-manager"
import { LLMClient } from "@/lib/agent/llm-client"
import type { AgentStep, AgentTaskMessage } from "@/lib/agent/types"
import { MESSAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type { ChromePort } from "@/types"

const MAX_STEPS = 15

export const handleAgentTask = async (
  port: ChromePort,
  message: AgentTaskMessage
) => {
  let llmClient: LLMClient | null = null
  let stopped = false

  const postStep = (msg: any) => {
    try {
      port.postMessage(msg)
    } catch {
      // ignore port closed errors
    }
  }

  // Stop listener
  port.onMessage.addListener((msg: any) => {
    if (msg?.type === MESSAGE_KEYS.AGENT.STOP) {
      stopped = true
      llmClient?.abort()
    }
  })

  try {
    const {
      task,
      model,
      maxSteps = MAX_STEPS,
      visionMode = false,
      autoRepeat = false,
      tabId: requestedTabId
    } = message.payload

    let completed = false
    let finalMessage: string | undefined
    let finalMode: "tool-calling" | "json-fallback" | undefined

    postStep({ type: "status", status: "running" })

    const initialTabId = await resolveTargetTabId(requestedTabId)
    if (!initialTabId) {
      postStep({
        type: "error",
        error: "No active tab found. Please open a web page first."
      })
      return
    }

    const session: AgentBrowserSession = {
      rootTabId: initialTabId,
      activeTabId: initialTabId,
      openedTabIds: []
    }

    // Connect to page
    postStep({
      type: "status",
      status: "running",
      message: "Connecting to page..."
    })
    const contentScriptOk = await ensureContentScript(session.activeTabId)
    if (!contentScriptOk) {
      postStep({
        type: "error",
        error:
          "Cannot connect to the page. " +
          "Please reload the page (press F5) and try again. " +
          "This happens when the extension is reloaded while the tab was already open."
      })
      return
    }

    // Retrieve Ollama base URL
    const baseUrl =
      (await plasmoGlobalStorage.get<string>("provider-base-url")) ||
      (await plasmoGlobalStorage.get<string>("ollama-base-url")) ||
      "http://localhost:11434"

    llmClient = new LLMClient(baseUrl, model, port)
    const contextManager = new ContextManager(task, visionMode)
    const actionExecutor = new ActionExecutor(session, port)

    postStep({
      type: "status",
      status: "running",
      message: "Reading page context..."
    })
    await contextManager.refreshContext(session, { reset: true })

    let agentMode: "tool-calling" | "json-fallback" | "detecting" = "detecting"
    let stepNumber = 0
    let repeatCount = 0

    do {
      if (repeatCount > 0) {
        postStep({
          type: "status",
          status: "running",
          message: `🔄 Repeat #${repeatCount} — refreshing page context...`
        })
        await wait(3000)
        await contextManager.refreshContext(session, { reset: true })
        agentMode = "detecting"
        stepNumber = 0
      }
      repeatCount++

      let taskDone = false

      while (stepNumber < maxSteps && !stopped && !taskDone) {
        stepNumber++

        const step: AgentStep = { stepNumber, timestamp: Date.now() }

        let currentImageBase64: string | null = null
        if (visionMode) {
          postStep({
            type: "status",
            status: "running",
            message: "Taking screenshot..."
          })
          currentImageBase64 = await captureVisionContext(session.activeTabId)
        }

        if (currentImageBase64) {
          contextManager.attachImageToLastUserMessage(currentImageBase64)
        }

        postStep({
          type: "status",
          status: "running",
          message: `Step ${stepNumber}${agentMode === "json-fallback" ? " (JSON mode)" : ""}...`,
          mode: agentMode === "detecting" ? undefined : agentMode
        })

        // Call the LLM
        let assistantMsg: { content: string; tool_calls?: unknown[] }
        try {
          if (agentMode === "json-fallback") {
            assistantMsg = await llmClient.callLLM(
              contextManager.getPayloadMessages("json-fallback"),
              false
            )
          } else {
            assistantMsg = await llmClient.callLLM(
              contextManager.getPayloadMessages("tool-calling"),
              true
            )
          }
        } catch (err) {
          postStep({
            type: "error",
            error: err instanceof Error ? err.message : String(err)
          })
          return
        }

        // Auto-detect mode
        if (agentMode === "detecting") {
          const hasToolCalls =
            Array.isArray(assistantMsg.tool_calls) &&
            assistantMsg.tool_calls.length > 0
          if (!hasToolCalls) {
            agentMode = "json-fallback"
            postStep({
              type: "status",
              status: "running",
              message:
                "Model doesn't support tool calling — switching to JSON mode",
              mode: "json-fallback"
            })
            await contextManager.refreshContext(session)
            stepNumber-- // retry step
            continue
          } else {
            agentMode = "tool-calling"
            postStep({
              type: "status",
              status: "running",
              message: "Tool calling supported",
              mode: "tool-calling"
            })
          }
        }

        // Process response
        if (agentMode === "tool-calling") {
          contextManager.addAssistantMessage(
            {
              role: "assistant",
              content: assistantMsg.content,
              tool_calls: assistantMsg.tool_calls as any
            },
            "tool-calling"
          )

          const toolCalls = assistantMsg.tool_calls as any[]
          if (!toolCalls || toolCalls.length === 0) {
            step.thought = assistantMsg.content || "Thinking without actions..."
            step.result = { success: false, message: "No tool called." }

            contextManager.addUserMessage(
              "You replied with text but did not call any tools. You MUST call a tool to interact with the page, or call 'task_complete' if the task is finished or impossible.",
              "tool-calling"
            )
            postStep({ type: "step", step, mode: "tool-calling" })
            continue
          }

          const toolCall = toolCalls[0]
          const toolName: string = toolCall.function?.name || ""
          let toolArgs: Record<string, unknown> = {}
          try {
            toolArgs =
              typeof toolCall.function?.arguments === "string"
                ? JSON.parse(toolCall.function.arguments)
                : toolCall.function?.arguments || {}
          } catch {
            toolArgs = {}
          }

          step.thought = assistantMsg.content
          step.action = { type: toolName as any, ...toolArgs }

          if (toolName === "task_complete") {
            const result = {
              success: toolArgs.success as boolean,
              message: toolArgs.message as string
            }
            postStep({ type: "step", step: { ...step, result } })
            taskDone = true
            completed = true
            finalMessage = result.message
            finalMode = "tool-calling"
            break
          }

          const toolResult = await actionExecutor.executeAction(
            toolName,
            toolArgs
          )
          step.result = toolResult

          contextManager.addToolMessage(
            toolCall.id || `tool_${stepNumber}`,
            toolName,
            JSON.stringify(toolResult)
          )

          if (actionExecutor.pendingContextReason) {
            await contextManager.refreshContext(session, {
              reason: actionExecutor.pendingContextReason
            })
            actionExecutor.pendingContextReason = null
          }

          postStep({ type: "step", step, mode: "tool-calling" })
        } else {
          // JSON fallback mode
          contextManager.addAssistantMessage(
            { role: "assistant", content: assistantMsg.content },
            "json-fallback"
          )

          const parsed = llmClient.parseJsonAction(assistantMsg.content)
          if (!parsed || !parsed.action) {
            step.thought = assistantMsg.content
            step.result = {
              success: false,
              message: "Model did not respond with JSON. Re-prompting..."
            }
            contextManager.addUserMessage(
              "You must respond with ONLY a JSON object. Try again.",
              "json-fallback"
            )
            postStep({ type: "step", step, mode: "json-fallback" })
            continue
          }

          const actionName = parsed.action as string
          const actionArgs = parsed as Record<string, unknown>
          step.action = { type: actionName as any, ...actionArgs }
          step.thought = undefined

          if (actionName === "task_complete") {
            const result = {
              success: parsed.success as boolean,
              message: parsed.message as string
            }
            postStep({
              type: "step",
              step: { ...step, result },
              mode: "json-fallback"
            })
            taskDone = true
            completed = true
            finalMessage = result.message
            finalMode = "json-fallback"
            break
          }

          const actionResult = await actionExecutor.executeAction(
            actionName,
            actionArgs
          )
          step.result = actionResult

          contextManager.addUserMessage(
            `Action result: ${JSON.stringify(actionResult)}\n\nWhat is your next action? Respond with ONLY a JSON object.`,
            "json-fallback"
          )

          if (actionExecutor.pendingContextReason) {
            await contextManager.refreshContext(session, {
              reason: actionExecutor.pendingContextReason
            })
            actionExecutor.pendingContextReason = null
          }

          postStep({ type: "step", step, mode: "json-fallback" })
        }

        if (stopped) break
      } // inner while
    } while (autoRepeat && !stopped && !completed) // outer try

    if (stopped) {
      postStep({
        type: "done",
        message: "Agent stopped by user.",
        totalSteps: stepNumber,
        status: "stopped"
      })
    } else if (completed) {
      postStep({
        type: "done",
        message: finalMessage,
        totalSteps: stepNumber,
        status: "done",
        mode: finalMode
      })
    } else if (!autoRepeat) {
      postStep({
        type: "done",
        message: `Reached maximum steps (${maxSteps}). Task may not be fully complete.`,
        totalSteps: stepNumber,
        status: "error"
      })
    }
  } catch (error) {
    console.error("Unhandled agent error:", error)
    postStep({
      type: "error",
      error: `Agent crashed: ${error instanceof Error ? error.stack || error.message : String(error)}`
    })
  }
}
