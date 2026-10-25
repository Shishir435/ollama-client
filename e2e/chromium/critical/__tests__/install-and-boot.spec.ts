import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { createServer } from "node:http"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { resolve } from "node:path"
import {
  compareWithBaseline,
  median,
  parsePerformanceBaseline,
  type ExtensionPerformanceReport,
  type PerformanceBaseline,
  type RegressionMetric
} from "../../../../tools/benchmarks/extension-performance-baseline"
import {
  createExtensionSession,
  expect,
  test,
  waitForProviderDefaults,
  type ExtensionSession
} from "../../fixtures/extension"

type StartupMetrics = {
  appMountMs: number | null
  domContentLoadedMs: number
  firstContentfulPaintMs: number | null
  longTaskBlockingMs: number
  longTaskCount: number
  loadEventEndMs: number
}
type ChatMetrics = {
  timeToFirstTokenMs: number
  completionMs: number
}

const MODEL = "extension-performance-fixture"
const RESPONSE_START = "fixture-"
const RESPONSE = "fixture-response-ok"
const STARTUP_BUDGET_MS = 10_000
const CHAT_BUDGET_MS = 10_000

const packagedScripts = (
  directory: string
): { bytes: number; count: number } => {
  let bytes = 0
  let count = 0
  const pending = [directory]

  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) continue
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name)
      if (entry.isDirectory()) {
        pending.push(path)
      } else if (entry.isFile() && entry.name.endsWith(".js")) {
        bytes += statSync(path).size
        count += 1
      }
    }
  }

  return { bytes, count }
}

const installStartupObservers = () => {
  const state = {
    appMountMs: null as number | null,
    longTaskBlockingMs: 0,
    longTaskCount: 0
  }
  Object.defineProperty(window, "__ollamaStartupMetrics", {
    value: state,
    configurable: false
  })

  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        state.longTaskCount += 1
        state.longTaskBlockingMs += Math.max(0, entry.duration - 50)
      }
    }).observe({ type: "longtask", buffered: true })
  } catch {
    // Long Task Timing is diagnostic. Startup and paint timings still apply.
  }

  const markAppMount = () => {
    if (state.appMountMs !== null) return
    if (!document.querySelector("#app > *")) return
    state.appMountMs = performance.now()
    observer.disconnect()
  }
  const observer = new MutationObserver(markAppMount)
  observer.observe(document, { childList: true, subtree: true })
  markAppMount()
}

const loadMeasuredSidepanel = async (
  extension: Pick<ExtensionSession, "context" | "extensionId">
): Promise<{ metrics: StartupMetrics; userAgent: string }> => {
  const page = await extension.context.newPage()
  await page.addInitScript(installStartupObservers)
  await page.goto(
    `chrome-extension://${extension.extensionId}/sidepanel.html`,
    { waitUntil: "load" }
  )
  await page.waitForFunction(
    () => Boolean(document.querySelector("#app > *")),
    undefined,
    { timeout: 15_000 }
  )
  await expect(page.locator("#app")).toBeVisible()
  await page.waitForFunction(
    () => performance.getEntriesByName("first-contentful-paint").length > 0,
    undefined,
    { timeout: 15_000 }
  )

  const metrics = await page.evaluate((): StartupMetrics => {
    const navigation = performance.getEntriesByType(
      "navigation"
    )[0] as PerformanceNavigationTiming
    const firstContentfulPaint = performance
      .getEntriesByType("paint")
      .find((entry) => entry.name === "first-contentful-paint")
    const state = (
      window as Window & {
        __ollamaStartupMetrics?: {
          appMountMs: number | null
          longTaskBlockingMs: number
          longTaskCount: number
        }
      }
    ).__ollamaStartupMetrics

    if (!navigation || !state) {
      throw new Error("Startup performance observers did not initialize")
    }

    return {
      appMountMs: state.appMountMs,
      domContentLoadedMs: navigation.domContentLoadedEventEnd,
      firstContentfulPaintMs: firstContentfulPaint?.startTime ?? null,
      longTaskBlockingMs: state.longTaskBlockingMs,
      longTaskCount: state.longTaskCount,
      loadEventEndMs: navigation.loadEventEnd
    }
  })
  const userAgent = await page.evaluate(() => navigator.userAgent)
  const runtimeIdentity = await page.evaluate(() => ({
    id: chrome.runtime.id,
    manifestVersion: chrome.runtime.getManifest().manifest_version
  }))
  expect(runtimeIdentity).toEqual({
    id: extension.extensionId,
    manifestVersion: 3
  })
  await page.close()
  return { metrics, userAgent }
}

const readBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString("utf8")
}

const sendJson = (response: ServerResponse, value: unknown): void => {
  response.setHeader("Content-Type", "application/json")
  response.end(JSON.stringify(value))
}

const startMockProvider = async () => {
  const prompts: string[] = []
  const server = createServer(async (request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*")
    response.setHeader("Access-Control-Allow-Headers", "*")
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    if (request.method === "OPTIONS") {
      response.statusCode = 204
      response.end()
      return
    }

    const path = request.url ?? ""
    if (path.endsWith("/api/tags")) {
      sendJson(response, {
        models: [
          {
            name: MODEL,
            model: MODEL,
            modified_at: new Date(0).toISOString(),
            size: 1,
            digest: "performance-fixture",
            details: { family: "fixture", families: ["fixture"] }
          }
        ]
      })
      return
    }
    if (path.endsWith("/api/show")) {
      sendJson(response, { capabilities: ["completion"] })
      return
    }
    if (path.endsWith("/api/chat")) {
      const body = JSON.parse(await readBody(request)) as {
        messages?: Array<{ role?: string; content?: string }>
      }
      prompts.push(
        [...(body.messages ?? [])]
          .reverse()
          .find((message) => message.role === "user")?.content ?? ""
      )
      response.setHeader("Content-Type", "application/x-ndjson")
      response.write(
        `${JSON.stringify({ message: { content: RESPONSE_START }, done: false })}\n`
      )
      await new Promise((resolvePause) => setTimeout(resolvePause, 15))
      response.write(
        `${JSON.stringify({ message: { content: "response-" }, done: false })}\n`
      )
      await new Promise((resolvePause) => setTimeout(resolvePause, 15))
      response.end(
        `${JSON.stringify({ message: { content: "ok" }, done: false })}\n${JSON.stringify({ message: { content: "" }, done: true })}\n`
      )
      return
    }

    response.statusCode = 404
    sendJson(response, { error: "not found" })
  })

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolveListen)
  })
  const { port } = server.address() as AddressInfo
  let closed = false
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    prompts,
    close: async () => {
      if (closed) return
      closed = true
      server.closeAllConnections()
      await new Promise<void>((resolveClose) =>
        server.close(() => resolveClose())
      )
    }
  }
}

const measureMockedChat = async (
  page: import("@playwright/test").Page,
  origin: string
): Promise<ChatMetrics> => {
  await waitForProviderDefaults(page)
  await page.evaluate(
    async ({ origin, model }) => {
      await chrome.storage.sync.set({
        "agent-announcement-dismissed-v1": JSON.stringify(true),
        llm_providers_config_v1: JSON.stringify([
          {
            id: "ollama",
            type: "ollama",
            name: "Performance fixture",
            enabled: true,
            baseUrl: origin
          }
        ]),
        "provider-selected-model-ref": JSON.stringify({
          providerId: "ollama",
          modelId: model
        })
      })
    },
    { origin, model: MODEL }
  )
  await page.reload()
  await page
    .getByRole("button", { name: "Skip for now", exact: true })
    .click({ timeout: 1_000 })
    .catch(() => {})
  await page
    .getByRole("button", { name: "Start Chatting" })
    .click({ timeout: 1_000 })
    .catch(() => {})

  const composer = page.locator("#chat-input-textarea")
  await expect(composer).toBeVisible()
  await composer.fill("Say hello briefly.")
  await page.evaluate(
    ({ responseStart, response }) => {
      const target = document.querySelector("#app")
      if (!target) throw new Error("The chat app root is missing")
      const state = {
        startedAt: null as number | null,
        timeToFirstTokenMs: null as number | null,
        completionMs: null as number | null
      }
      Object.defineProperty(window, "__extensionChatPerformance", {
        value: state,
        configurable: true
      })
      document.addEventListener(
        "keydown",
        (event) => {
          if (
            event.key !== "Enter" ||
            event.shiftKey ||
            !(event.target instanceof HTMLTextAreaElement) ||
            event.target.id !== "chat-input-textarea" ||
            state.startedAt !== null
          ) {
            return
          }
          state.startedAt = performance.now()
        },
        true
      )
      const observer = new MutationObserver(() => {
        if (state.startedAt === null) return
        const rendered = target.textContent ?? ""
        if (
          state.timeToFirstTokenMs === null &&
          rendered.includes(responseStart)
        ) {
          state.timeToFirstTokenMs = performance.now() - state.startedAt
        }
        if (state.completionMs === null && rendered.includes(response)) {
          state.completionMs = performance.now() - state.startedAt
          observer.disconnect()
        }
      })
      observer.observe(target, {
        childList: true,
        characterData: true,
        subtree: true
      })
    },
    { responseStart: RESPONSE_START, response: RESPONSE }
  )
  await composer.press("Enter")
  await page.waitForFunction(
    () => {
      const state = (
        window as Window & {
          __extensionChatPerformance?: { completionMs: number | null }
        }
      ).__extensionChatPerformance
      return state?.completionMs !== null && state?.completionMs !== undefined
    },
    undefined,
    { timeout: CHAT_BUDGET_MS }
  )
  const metrics = await page.evaluate(() => {
    const state = (
      window as Window & {
        __extensionChatPerformance?: {
          timeToFirstTokenMs: number | null
          completionMs: number | null
        }
      }
    ).__extensionChatPerformance
    if (
      !state ||
      state.timeToFirstTokenMs === null ||
      state.completionMs === null
    ) {
      throw new Error("Mocked chat did not produce complete timing marks")
    }
    return {
      timeToFirstTokenMs: state.timeToFirstTokenMs,
      completionMs: state.completionMs
    }
  })
  expect(metrics.timeToFirstTokenMs).toBeLessThan(CHAT_BUDGET_MS)
  expect(metrics.completionMs).toBeLessThan(CHAT_BUDGET_MS)
  await expect(page.getByText(RESPONSE, { exact: true })).toBeVisible()
  return metrics
}

const medianMetric = <K extends keyof StartupMetrics>(
  samples: StartupMetrics[],
  key: K
): StartupMetrics[K] => {
  const values = samples.map((sample) => sample[key])
  if (values.some((value) => value === null)) return null as StartupMetrics[K]
  return median(values as number[]) as StartupMetrics[K]
}

const readBaseline = (): PerformanceBaseline | null => {
  const path = resolve(
    process.cwd(),
    "tools/benchmarks/extension-performance-baseline.json"
  )
  return existsSync(path)
    ? parsePerformanceBaseline(
        JSON.parse(readFileSync(path, "utf8")) as unknown
      )
    : null
}

test("@critical @performance production extension installs, boots, and completes a mocked chat", async ({
  extension
}, testInfo) => {
  test.setTimeout(120_000)
  const manifest = JSON.parse(
    readFileSync(resolve(extension.buildPath, "manifest.json"), "utf8")
  ) as {
    manifest_version?: number
  }
  expect(manifest.manifest_version).toBe(3)
  expect(
    existsSync(resolve(extension.buildPath, "persistence-verify.html"))
  ).toBe(false)
  const packagedJavaScript = packagedScripts(extension.buildPath)
  expect(packagedJavaScript.count).toBeGreaterThan(0)

  const mock = await startMockProvider()
  const startupSamples: StartupMetrics[] = []
  const chatSamples: ChatMetrics[] = []
  const userAgents: string[] = []
  try {
    for (let index = 0; index < 3; index++) {
      const runtime =
        index === 0 ? null : await createExtensionSession(testInfo)
      const session = runtime?.session ?? extension
      try {
        const { metrics: startup, userAgent } =
          await loadMeasuredSidepanel(session)
        if (
          startup.firstContentfulPaintMs === null ||
          startup.appMountMs === null
        ) {
          throw new Error(
            "Side panel did not report paint and app mount timings"
          )
        }
        expect(startup.firstContentfulPaintMs).toBeLessThan(STARTUP_BUDGET_MS)
        expect(startup.appMountMs).toBeLessThan(STARTUP_BUDGET_MS)
        startupSamples.push(startup)
        userAgents.push(userAgent)

        if (index === 0) {
          const optionsPage = await session.context.newPage()
          await optionsPage.goto(
            `chrome-extension://${session.extensionId}/options.html`
          )
          await expect(optionsPage.locator("#app")).toBeVisible()
          await optionsPage.close()
        }

        const panel = await session.context.newPage()
        await panel.goto(
          `chrome-extension://${session.extensionId}/sidepanel.html`
        )
        chatSamples.push(await measureMockedChat(panel, mock.baseUrl))
        await panel.close()

        for (const serviceWorker of session.context.serviceWorkers()) {
          expect(new URL(serviceWorker.url()).host).toBe(session.extensionId)
        }
      } finally {
        if (runtime) await runtime.close()
        else await session.context.close()
      }
    }
  } finally {
    await mock.close()
  }
  expect(mock.prompts).toHaveLength(3)
  expect(
    mock.prompts.every((prompt) => prompt.includes("Say hello briefly."))
  ).toBe(true)

  const userAgent = userAgents[0]
  const browserMajor = userAgent.match(/(?:Chrome|Chromium)\/(\d+)/)?.[1]
  if (!browserMajor)
    throw new Error(`Cannot identify Chromium version: ${userAgent}`)
  const startupValues = {
    firstContentfulPaintMs: medianMetric(
      startupSamples,
      "firstContentfulPaintMs"
    ) as number,
    appMountMs: medianMetric(startupSamples, "appMountMs") as number,
    domContentLoadedMs: medianMetric(startupSamples, "domContentLoadedMs"),
    loadEventEndMs: medianMetric(startupSamples, "loadEventEndMs"),
    longTaskBlockingMs: medianMetric(startupSamples, "longTaskBlockingMs"),
    longTaskCount: medianMetric(startupSamples, "longTaskCount")
  }
  const chatMetrics = {
    chatTimeToFirstTokenMs: median(
      chatSamples.map((sample) => sample.timeToFirstTokenMs)
    ),
    chatCompletionMs: median(chatSamples.map((sample) => sample.completionMs))
  }
  const metrics = {
    ...startupValues,
    ...chatMetrics,
    packagedJavaScriptBytes: packagedJavaScript.bytes,
    packagedJavaScriptFiles: packagedJavaScript.count
  }
  const report: ExtensionPerformanceReport = {
    schemaVersion: 1,
    measuredAt: new Date().toISOString(),
    browser: {
      major: browserMajor,
      project: testInfo.project.name,
      userAgent
    },
    runner: {
      arch: process.arch,
      commitSha: process.env.GITHUB_SHA ?? "local",
      nodeMajor: process.versions.node.split(".")[0],
      os: process.env.RUNNER_OS ?? process.platform,
      workflowRunId: process.env.GITHUB_RUN_ID ?? ""
    },
    sampleCount: startupSamples.length,
    metrics: Object.fromEntries(
      Object.entries(metrics).filter(
        (entry): entry is [RegressionMetric, number] =>
          [
            "firstContentfulPaintMs",
            "appMountMs",
            "chatTimeToFirstTokenMs",
            "chatCompletionMs"
          ].includes(entry[0])
      )
    ) as Record<RegressionMetric, number>,
    samples: startupSamples.map((startup, index) => ({
      profile: "fresh extension profile",
      startup,
      chat: chatSamples[index]
    }))
  }
  const baseline = readBaseline()
  const check = compareWithBaseline(report, baseline)
  const result = {
    browser: report.browser,
    budgetMs: { startup: STARTUP_BUDGET_MS, mockedChat: CHAT_BUDGET_MS },
    comparison: check,
    measuredAt: report.measuredAt,
    metrics,
    profile: "three fresh extension profiles",
    runner: report.runner,
    sampleCount: report.sampleCount,
    schemaVersion: report.schemaVersion,
    samples: report.samples
  }
  testInfo.annotations.push({
    type: "extension-performance",
    description: JSON.stringify(report)
  })
  console.log(`[extension-performance] ${JSON.stringify(result)}`)
  expect(check.failures).toEqual([])
})
