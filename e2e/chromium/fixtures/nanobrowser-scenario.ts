import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import type { Page, Request } from "@playwright/test"
import { nanobrowserBenchmarkReasoningEffort } from "../benchmark/benchmark-config"
import type { AgentScenario, AgentScenarioOutcome } from "./agent-scenario"
import { expect, test } from "./extension"

interface NanobrowserEvent {
  actor?: string
  state?: string
  data?: { details?: string; step?: number }
}

declare global {
  interface Window {
    __benchmarkNanobrowserEvents?: NanobrowserEvent[]
    recordNanobrowserEvent?: (event: unknown) => Promise<void>
  }
}

const sidePanelPath = "side-panel/index.html"
const hostedModel = process.env.AGENT_HOSTED_MODEL ?? "codex/gpt-6-luna"
const hostedBaseUrl =
  process.env.AGENT_HOSTED_BASE_URL ?? "http://127.0.0.1:8083"
const hostedReasoningEffort = nanobrowserBenchmarkReasoningEffort()
const safeRequestFailureCode = (request: Request): string => {
  const errorText = request.failure()?.errorText ?? ""
  return /net::ERR_[A-Z0-9_]+/.exec(errorText)?.[0] ?? "other"
}

const safeEventLabel = (value: unknown): string | undefined =>
  typeof value === "string" &&
  value.length <= 100 &&
  /^[a-zA-Z0-9_.:-]+$/.test(value)
    ? value
    : undefined

const terminalTaskStates = new Set([
  "task.ok",
  "task.fail",
  "task.pause",
  "task.cancel"
])

const terminalTaskEvents = (events: NanobrowserEvent[]): NanobrowserEvent[] =>
  events.filter((event) => terminalTaskStates.has(event.state ?? ""))

/** Run the same frozen page/task through Nanobrowser's Planner and Navigator. */
export const runNanobrowserScenario = (scenario: AgentScenario): void => {
  const attempts = Math.max(1, scenario.attempts ?? 1)
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    test(`Nanobrowser ${scenario.name} through its Planner and Navigator`, async ({
      extension
    }, testInfo) => {
      test.setTimeout(240_000)
      const startedAt = Date.now()
      scenario.diagnosticTrace?.({
        type: "scenario_started",
        attempt,
        model: hostedModel,
        executionPath: "planner_navigator",
        fixtureData: true
      })
      let effects = 0
      let modelCalls = 0
      let timedOut = false
      let terminalStatus = "not_started"
      let fixturePage: Page | undefined
      const modelRequestStarted = new WeakMap<Request, number>()
      await extension.context.route("https://app.posthog.com/**", (route) =>
        route.abort()
      )
      extension.context.on("request", (request) => {
        let path: string
        try {
          path = new URL(request.url()).pathname
        } catch {
          return
        }
        if (!path.endsWith("/v1/chat/completions")) return
        modelRequestStarted.set(request, Date.now())
        modelCalls += 1
        scenario.diagnosticTrace?.({
          type: "model_call_started",
          attempt,
          modelRoute: "chat_completion"
        })
      })
      extension.context.on("response", (response) => {
        const request = response.request()
        const requestStartedAt = modelRequestStarted.get(request)
        if (requestStartedAt === undefined) return
        void response
          .finished()
          .then((failure) => {
            const stillPendingAt = modelRequestStarted.get(request)
            if (stillPendingAt === undefined) return
            modelRequestStarted.delete(request)
            scenario.diagnosticTrace?.({
              type: failure ? "model_call_failed" : "model_call_completed",
              attempt,
              modelRoute: "chat_completion",
              httpStatus: response.status(),
              durationMs: Date.now() - stillPendingAt,
              ...(failure ? { failureClass: "response_stream_failed" } : {})
            })
          })
          .catch(() => {
            const stillPendingAt = modelRequestStarted.get(request)
            if (stillPendingAt === undefined) return
            modelRequestStarted.delete(request)
            scenario.diagnosticTrace?.({
              type: "model_call_failed",
              attempt,
              modelRoute: "chat_completion",
              httpStatus: response.status(),
              durationMs: Date.now() - stillPendingAt,
              failureClass: "response_stream_failed"
            })
          })
      })
      extension.context.on("requestfailed", (request) => {
        const requestStartedAt = modelRequestStarted.get(request)
        if (requestStartedAt === undefined) return
        modelRequestStarted.delete(request)
        scenario.diagnosticTrace?.({
          type: "model_call_failed",
          attempt,
          modelRoute: "chat_completion",
          durationMs: Date.now() - requestStartedAt,
          failureClass: "request_failed",
          failureCode: safeRequestFailureCode(request)
        })
      })
      const server = createServer(async (request, response) => {
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(Buffer.from(chunk))
        const path = request.url ?? "/"
        if (path === "/effect") {
          effects += 1
          response.end("ok")
          return
        }
        const redirect = scenario.redirect?.(path)
        if (redirect) {
          response.writeHead(303, { Location: redirect })
          response.end()
          return
        }
        const delay = scenario.navigationDelayMs?.(path) ?? 0
        if (delay > 0)
          await new Promise((resolve) => setTimeout(resolve, delay))
        response.setHeader("Content-Type", "text/html")
        response.end(scenario.html(path))
      })
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve)
      )

      try {
        const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
        const panel = await extension.context.newPage()
        await panel.exposeFunction(
          "recordNanobrowserEvent",
          (event: unknown) => {
            if (typeof event !== "object" || event === null) return
            const candidate = event as NanobrowserEvent
            const actor = safeEventLabel(candidate.actor)
            const state = safeEventLabel(candidate.state)
            const step = candidate.data?.step
            scenario.diagnosticTrace?.({
              type: "nanobrowser_event",
              attempt,
              actor,
              state,
              ...(typeof step === "number" && Number.isFinite(step)
                ? { step }
                : {})
            })
          }
        )
        await panel.addInitScript(() => {
          window.__benchmarkNanobrowserEvents = []
          try {
            const runtime = chrome.runtime
            const connect = runtime.connect.bind(runtime)
            runtime.connect = ((
              ...args: Parameters<typeof runtime.connect>
            ) => {
              const port = connect(...args)
              port.onMessage.addListener((message: unknown) => {
                if (
                  typeof message === "object" &&
                  message !== null &&
                  "state" in message
                ) {
                  window.__benchmarkNanobrowserEvents?.push(
                    message as NanobrowserEvent
                  )
                  void window.recordNanobrowserEvent?.(message)
                }
              })
              return port
            }) as typeof runtime.connect
          } catch {
            /* The visible chat remains the fallback if Chrome locks the API. */
          }
        })
        await panel.goto(
          `chrome-extension://${extension.extensionId}/${sidePanelPath}`
        )
        await panel.evaluate(
          async ({ model, baseUrl, reasoningEffort }) => {
            await chrome.storage.local.set({
              "analytics-settings": {
                enabled: false,
                anonymousUserId: "benchmark"
              },
              // The shared OLC model catalog reports image input support, so
              // let Nano use it for the suite's canvas/visual task.
              "general-settings": {
                useVision: true,
                useVisionForPlanner: true,
                displayHighlights: true
              },
              "llm-api-keys": {
                providers: {
                  custom_olc: {
                    // LangChain's OpenAI client expects a non-empty key; OLC
                    // is loopback-only here and does not authenticate it.
                    apiKey: "olc-local",
                    name: "OLC benchmark",
                    type: "custom_openai",
                    baseUrl: `${baseUrl}/v1`,
                    modelNames: [model]
                  }
                }
              },
              "agent-models": {
                agents: {
                  planner: {
                    provider: "custom_olc",
                    modelName: model,
                    reasoningEffort
                  },
                  navigator: {
                    provider: "custom_olc",
                    modelName: model,
                    reasoningEffort
                  }
                }
              }
            })
          },
          {
            model: hostedModel,
            baseUrl: hostedBaseUrl,
            reasoningEffort: hostedReasoningEffort
          }
        )
        await panel.reload()

        const page = await extension.context.newPage()
        fixturePage = page
        await page.goto(origin)
        await page.bringToFront()
        const composer = panel.getByPlaceholder("What can I help you with?")
        await expect(composer).toBeEnabled({ timeout: 30_000 })
        await composer.fill(scenario.goal)
        await composer.press("Enter")
        await expect(composer).toBeDisabled({ timeout: 10_000 })

        try {
          await expect
            .poll(
              async () => {
                const enabled = await composer.isEnabled().catch(() => false)
                const blocks = await panel
                  .locator("div.max-w-full.space-y-4 > div")
                  .count()
                return enabled && blocks > 1
              },
              { timeout: 200_000 }
            )
            .toBe(true)
        } catch {
          timedOut = true
        }

        let events = await panel
          .evaluate(() => window.__benchmarkNanobrowserEvents ?? [])
          .catch(() => [] as NanobrowserEvent[])
        let terminalEvents = terminalTaskEvents(events)
        let taskEvent = terminalEvents.at(-1)
        let chatResponse =
          taskEvent?.data?.details ??
          (await panel
            .locator("div.max-w-full.space-y-4 > div")
            .last()
            .innerText()
            .catch(() => ""))

        if (
          scenario.answer &&
          taskEvent?.state === "task.ok" &&
          chatResponse.includes("?")
        ) {
          const priorTerminalEventCount = terminalEvents.length
          await composer.fill(scenario.answer)
          await composer.press("Enter")
          await expect(composer).toBeDisabled({ timeout: 10_000 })
          try {
            await expect
              .poll(
                async () => {
                  events = await panel
                    .evaluate(() => window.__benchmarkNanobrowserEvents ?? [])
                    .catch(() => [] as NanobrowserEvent[])
                  terminalEvents = terminalTaskEvents(events)
                  const enabled = await composer.isEnabled().catch(() => false)
                  return (
                    enabled && terminalEvents.length > priorTerminalEventCount
                  )
                },
                { timeout: 200_000 }
              )
              .toBe(true)
          } catch {
            timedOut = true
          }
          events = await panel
            .evaluate(() => window.__benchmarkNanobrowserEvents ?? [])
            .catch(() => [] as NanobrowserEvent[])
          terminalEvents = terminalTaskEvents(events)
          taskEvent = terminalEvents.at(-1)
          chatResponse =
            taskEvent?.data?.details ??
            (await panel
              .locator("div.max-w-full.space-y-4 > div")
              .last()
              .innerText()
              .catch(() => ""))
          scenario.diagnosticTrace?.({
            type: "clarification_answer_sent",
            attempt
          })
        }
        terminalStatus =
          taskEvent?.state?.slice("task.".length) ??
          (timedOut ? "timed_out" : "failed")
        const statusMap: Record<string, string> = {
          ok: "completed",
          fail: "failed",
          pause: "paused",
          cancel: "cancelled"
        }
        const taskStatus = statusMap[terminalStatus] ?? terminalStatus
        scenario.diagnosticTrace?.({
          type: "nanobrowser_run_result",
          attempt,
          executionPath: "planner_navigator",
          status: taskStatus,
          modelCalls,
          steps: new Set(
            events
              .filter((event) => event.actor === "navigator")
              .map((event) => event.data?.step)
              .filter((step): step is number => typeof step === "number")
          ).size,
          timedOut,
          eventCount: events.length
        })
        const outcome: AgentScenarioOutcome = {
          page: fixturePage,
          panel,
          snapshot: undefined,
          messages: [],
          wire: [],
          effects: () => effects,
          phases: [],
          backend: "nanobrowser",
          attempt,
          startedAt,
          tokens: undefined,
          chatResponse,
          chatModelCalls: modelCalls,
          directChatResponse: false,
          terminalStatus: taskStatus,
          executionPath: "planner_navigator"
        }
        await scenario.verify(outcome)
        await testInfo.attach("nanobrowser-benchmark-summary", {
          body: JSON.stringify(
            {
              task: scenario.name,
              terminalStatus: taskStatus,
              modelCalls,
              effects,
              steps: new Set(
                events
                  .filter((event) => event.actor === "navigator")
                  .map((event) => event.data?.step)
                  .filter((step): step is number => typeof step === "number")
              ).size,
              timedOut
            },
            null,
            2
          ),
          contentType: "application/json"
        })
      } finally {
        scenario.diagnosticTrace?.({
          type: "fixture_observed_end",
          attempt,
          executionPath: "planner_navigator",
          status: terminalStatus,
          modelCalls,
          timedOut
        })
        server.closeAllConnections()
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
    })
  }
}
