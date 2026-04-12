import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  type BrowserContext,
  chromium,
  type Page,
  type Route
} from "playwright"

const extensionPath = path.resolve("build/chrome-mv3-prod")

const buildToolCallResponse = (
  name: string,
  args: Record<string, unknown>
) => ({
  message: {
    content: "",
    tool_calls: [
      {
        id: "tool_1",
        function: {
          name,
          arguments: JSON.stringify(args)
        }
      }
    ]
  }
})

const buildTaskCompleteResponse = (message: string) => ({
  message: {
    content: "",
    tool_calls: [
      {
        id: "tool_2",
        function: {
          name: "task_complete",
          arguments: JSON.stringify({
            success: true,
            message
          })
        }
      }
    ]
  }
})

const fulfillOllamaRoute = async (route: Route, body: unknown) => {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body)
  })
}

export const ensureBuiltExtension = () => {
  if (!fs.existsSync(extensionPath)) {
    throw new Error(`Extension build not found: ${extensionPath}`)
  }
  return extensionPath
}

export const launchExtensionContext = async (): Promise<{
  context: BrowserContext
  extensionId: string
}> => {
  ensureBuiltExtension()
  let lastError: unknown

  for (let launchAttempt = 0; launchAttempt < 3; launchAttempt++) {
    const userDataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "ollama-client-e2e-")
    )

    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`
      ]
    })

    try {
      const waitForExtensionServiceWorker = async () => {
        let serviceWorker = context
          .serviceWorkers()
          .find((worker) => worker.url().startsWith("chrome-extension://"))

        if (serviceWorker) return serviceWorker

        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            serviceWorker = await context.waitForEvent("serviceworker", {
              timeout: 10000
            })
            if (serviceWorker.url().startsWith("chrome-extension://")) {
              return serviceWorker
            }
          } catch {
            const page = await context.newPage()
            await page.goto("chrome://extensions/", {
              waitUntil: "domcontentloaded"
            })
            await page.close()
          }
        }

        throw new Error("Extension service worker did not start in time")
      }

      const serviceWorker = await waitForExtensionServiceWorker()
      const extensionId = new URL(serviceWorker.url()).host
      return { context, extensionId }
    } catch (error) {
      lastError = error
      await context.close().catch(() => {})
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to launch extension context")
}

export const mockOllamaForTask = async (
  context: BrowserContext,
  taskMatcher: RegExp,
  toolCallFactory: (input: {
    content: string
    step: number
  }) => { name: string; args: Record<string, unknown> } | null,
  completionMessage: string
) => {
  let chatStep = 0
  let currentTaskKey = ""

  await context.route("http://localhost:11434/api/tags", async (route) => {
    await fulfillOllamaRoute(route, {
      models: [
        {
          name: "qwen-agent:latest",
          model: "qwen-agent:latest",
          modified_at: new Date().toISOString(),
          size: 1,
          digest: "digest",
          details: {
            format: "gguf",
            family: "qwen",
            families: ["qwen"],
            parameter_size: "7B",
            quantization_level: "Q4_0"
          }
        }
      ]
    })
  })

  await context.route("http://localhost:11434/api/version", async (route) => {
    await fulfillOllamaRoute(route, { version: "0.0.0-test" })
  })

  await context.route("http://localhost:11434/api/chat", async (route) => {
    const request = route.request()
    const payload = request.postDataJSON() as
      | { messages?: Array<{ content?: string }> }
      | undefined
    const content =
      payload?.messages?.map((message) => message.content || "").join("\n") ||
      ""
    const taskKey =
      content.match(/Task:\s*(.+)/)?.[1]?.trim() || taskMatcher.source

    if (!taskMatcher.test(content)) {
      await fulfillOllamaRoute(
        route,
        buildTaskCompleteResponse("Unhandled mocked task")
      )
      return
    }

    if (taskKey !== currentTaskKey) {
      currentTaskKey = taskKey
      chatStep = 0
    }

    chatStep++
    const nextAction = toolCallFactory({
      content,
      step: chatStep
    })
    if (nextAction) {
      await fulfillOllamaRoute(
        route,
        buildToolCallResponse(nextAction.name, nextAction.args)
      )
      return
    }

    await fulfillOllamaRoute(
      route,
      buildTaskCompleteResponse(completionMessage)
    )
  })
}

export const openSidepanelAndStartChat = async (
  context: BrowserContext,
  extensionId: string
): Promise<Page> => {
  const sidepanel = await context.newPage()
  await sidepanel.goto(`chrome-extension://${extensionId}/sidepanel.html`)
  await sidepanel.evaluate(async () => {
    await chrome.storage.local.set({
      llm_providers_config_v1: [
        {
          id: "ollama",
          type: "ollama",
          name: "Ollama",
          enabled: true,
          baseUrl: "http://localhost:11434"
        }
      ],
      "provider-selected-model": "qwen-agent:latest",
      "provider-selected-model-ref": {
        providerId: "ollama",
        modelId: "qwen-agent:latest"
      },
      "provider-selection-conflict-model": null
    })
  })
  await sidepanel.reload()
  await sidepanel.getByRole("button", { name: /start/i }).click()
  await sidepanel.locator("#agent-mode-toggle").waitFor({ state: "visible" })
  await sidepanel.locator("#agent-mode-toggle").click()
  return sidepanel
}

export const openSidepanel = async (
  context: BrowserContext,
  extensionId: string
): Promise<Page> => {
  const sidepanel = await context.newPage()
  await sidepanel.goto(`chrome-extension://${extensionId}/sidepanel.html`)
  return sidepanel
}

export const runAgentTask = async (
  extensionPage: Page,
  task: string,
  overrides?: Partial<{
    model: string
    maxSteps: number
    visionMode: boolean
    autoRepeat: boolean
    targetUrlIncludes: string
  }>
) => {
  return extensionPage.evaluate(
    ({ task: requestedTask, overrides: taskOverrides }) =>
      new Promise<{
        status: string
        message?: string
        error?: string
        totalSteps?: number
        mode?: string
        stream: Array<{
          type?: string
          status?: string
          message?: string
          error?: string
          mode?: string
          step?: unknown
        }>
      }>((resolve, reject) => {
        const stream: Array<{
          type?: string
          status?: string
          message?: string
          error?: string
          mode?: string
          step?: unknown
        }> = []
        const timeoutId = window.setTimeout(() => {
          try {
            port.disconnect()
          } catch {}
          reject(new Error(`Agent task timed out: ${requestedTask}`))
        }, 90000)

        void chrome.tabs
          .query({})
          .then((tabs) => {
            const targetTab = taskOverrides?.targetUrlIncludes
              ? tabs
                  .filter(
                    (tab) =>
                      typeof tab.id === "number" &&
                      typeof tab.url === "string" &&
                      tab.url.includes(taskOverrides.targetUrlIncludes || "") &&
                      !tab.url.startsWith("chrome-extension://")
                  )
                  .sort(
                    (a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0)
                  )[0]
              : undefined

            const port = chrome.runtime.connect({
              name: "agent-execute-task"
            })

            port.onMessage.addListener((message) => {
              stream.push({
                type:
                  typeof message?.type === "string" ? message.type : undefined,
                status:
                  typeof message?.status === "string"
                    ? message.status
                    : undefined,
                message:
                  typeof message?.message === "string"
                    ? message.message
                    : undefined,
                error:
                  typeof message?.error === "string"
                    ? message.error
                    : undefined,
                mode:
                  typeof message?.mode === "string" ? message.mode : undefined,
                step: message?.step
              })

              if (message?.type === "done") {
                clearTimeout(timeoutId)
                try {
                  port.disconnect()
                } catch {}
                resolve({
                  status: String(message.status || "done"),
                  message:
                    typeof message.message === "string"
                      ? message.message
                      : undefined,
                  totalSteps:
                    typeof message.totalSteps === "number"
                      ? message.totalSteps
                      : undefined,
                  mode:
                    typeof message.mode === "string" ? message.mode : undefined,
                  stream
                })
              }

              if (message?.type === "error") {
                clearTimeout(timeoutId)
                try {
                  port.disconnect()
                } catch {}
                reject(
                  new Error(
                    typeof message.error === "string"
                      ? message.error
                      : "Unknown agent error"
                  )
                )
              }
            })

            port.postMessage({
              type: "agent-execute-task",
              payload: {
                task: requestedTask,
                model: taskOverrides?.model || "qwen-agent:latest",
                maxSteps: taskOverrides?.maxSteps ?? 10,
                visionMode: taskOverrides?.visionMode ?? false,
                autoRepeat: taskOverrides?.autoRepeat ?? false,
                tabId: targetTab?.id
              }
            })
          })
          .catch((error) => {
            clearTimeout(timeoutId)
            reject(error instanceof Error ? error : new Error(String(error)))
          })
      }),
    { task, overrides }
  )
}
