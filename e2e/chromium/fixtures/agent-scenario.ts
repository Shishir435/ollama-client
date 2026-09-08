import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import type {
  AgentPanelMessage,
  AgentPanelSnapshot
} from "@ollama-client/contracts"
import type { Page } from "@playwright/test"

import { expect, test } from "./extension"

/**
 * One supervised Agent run, end to end, against a scripted model.
 *
 * Every scenario needs the same apparatus — a local origin serving both the
 * fixture pages and the provider wire, a panel port that auto-approves, the
 * trace attachments a failure is read from — and differs only in the page it
 * serves, the decisions the scripted model answers, and what it then asserts.
 * Keeping the apparatus here is what lets a scenario be one file: the earlier
 * shape put every scenario in one spec, which made the spec the single file
 * every change to the agent had to edit.
 */

/** The observation fields a scripted decision is allowed to read. */
export interface AgentFixtureElement {
  ref: string
  tag: string
  role?: string
  name?: string
  type?: string
  value?: string
  checked?: boolean
  href?: string
  visible: boolean
  enabled: boolean
  editable: boolean
  sensitive: boolean
}

export interface AgentFixtureObservation {
  url: string
  title: string
  visibleText: string
  elements: AgentFixtureElement[]
}

export interface AgentScenarioContext {
  /** 1 for the first decision the scripted model answers. */
  step: number
  page: Page
}

export interface AgentScenarioOutcome {
  page: Page
  panel: Page
  snapshot: AgentPanelSnapshot | undefined
  messages: AgentPanelMessage[]
  /** Recorded provider round trips, newest last. */
  wire: { request: unknown; decision?: unknown; response?: string }[]
  /** Live count, so an assertion can poll it. */
  effects: () => number
}

export interface AgentScenario {
  /** Names the test and the scenario in its attachments. */
  name: string
  goal: string
  /** The terminal run status the scenario is finished at. */
  status: "completed" | "paused"
  /** Included in the hosted-model matrix, which only runs a couple of tasks. */
  hosted?: boolean
  timeoutMs?: number
  html(path: string): string
  navigationDelayMs?(path: string): number
  decide(
    observation: AgentFixtureObservation,
    context: AgentScenarioContext
  ): unknown
  verify(outcome: AgentScenarioOutcome): Promise<void> | void
}

/** The destination the form and link scenarios both settle on. */
export const AGENT_DETAILS_PAGE =
  "<!doctype html><title>Details</title><main><h1>Details</h1><p>Status: Active</p></main>"

/** A control whose activation is observable: it fetches, then rewrites the page. */
export const agentConfirmingButton = (label = "Continue"): string =>
  `<button type="button" onclick="fetch('/effect');document.querySelector('main').insertAdjacentHTML('beforeend','<p>Status: Active</p>');this.remove();">${label}</button>`

export const agentFixtureElement = (
  observation: AgentFixtureObservation,
  match: (element: AgentFixtureElement) => boolean
): AgentFixtureElement | undefined => observation.elements.find(match)

const readObservation = (request: {
  messages: { content: string }[]
}): AgentFixtureObservation =>
  JSON.parse(request.messages.at(-1)?.content ?? "{}")
    .observation as AgentFixtureObservation

export const runAgentScenario = (scenario: AgentScenario): void => {
  /** Synthetic page data only. No user profile or credentials enter this harness. */
  test(`@critical Agent ${scenario.name} through production boundaries`, async ({
    extension
  }, testInfo) => {
    const liveModel = process.env.AGENT_HOSTED_MODEL
    test.setTimeout(liveModel ? 240_000 : (scenario.timeoutMs ?? 60_000))
    test.skip(
      Boolean(liveModel) && scenario.hosted !== true,
      "Live model matrix uses form and delayed navigation tasks"
    )

    let fixturePage: Page | undefined
    let effects = 0
    let step = 0
    const phases: unknown[] = []
    const wire: AgentScenarioOutcome["wire"] = []
    const messages: AgentPanelMessage[] = []
    const model = liveModel || "fixture-agent"

    for (const worker of extension.context.serviceWorkers()) {
      await worker.evaluate(() => {
        ;(
          globalThis as typeof globalThis & {
            __OLLAMA_CLIENT_AGENT_TRACE__?: boolean
          }
        ).__OLLAMA_CLIENT_AGENT_TRACE__ = true
      })
      worker.on("console", async (message) => {
        if (message.text().includes("Agent run trace"))
          phases.push(
            await Promise.all(message.args().map((arg) => arg.jsonValue()))
          )
      })
    }

    /** Forwarded verbatim when the matrix runs a real model behind the proxy. */
    const forwardToHostedModel = async (
      path: string,
      method: string | undefined,
      body: string
    ): Promise<{ status: number; body: string }> => {
      const upstream = await fetch(`http://127.0.0.1:8084${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body ? { body } : {})
      })
      const text = await upstream.text()
      if (path === "/api/chat" || path === "/v1/chat/completions")
        wire.push({ request: JSON.parse(body), response: text })
      return { status: upstream.status, body: text }
    }

    const answerDecision = async (body: string): Promise<string> => {
      const parsed = JSON.parse(body)
      step += 1
      const decision = await scenario.decide(readObservation(parsed), {
        step,
        page: fixturePage as Page
      })
      wire.push({ request: parsed, decision })
      return `${JSON.stringify({
        model,
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            { function: { name: "agent_decision", arguments: decision } }
          ]
        },
        done: true
      })}\n`
    }

    const scriptedProviderBody = async (
      path: string,
      body: string
    ): Promise<string> => {
      if (path === "/api/tags")
        return JSON.stringify({
          models: [{ name: model, model, details: { family: "fixture" } }]
        })
      if (path === "/api/show")
        return JSON.stringify({ capabilities: ["completion", "tools"] })
      if (path === "/api/chat") return answerDecision(body)
      return "{}"
    }

    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body = Buffer.concat(chunks).toString()
      const path = request.url ?? "/"
      if (path === "/effect") {
        effects += 1
        response.end("ok")
        return
      }
      if (path.startsWith("/api/") || path.startsWith("/v1/")) {
        response.setHeader("Content-Type", "application/json")
        const answered = liveModel
          ? await forwardToHostedModel(path, request.method, body)
          : { status: 200, body: await scriptedProviderBody(path, body) }
        response.writeHead(answered.status)
        response.end(answered.body)
        return
      }
      // Real sites acknowledge navigation before the document finishes loading.
      const delay = scenario.navigationDelayMs?.(path) ?? 0
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
      response.setHeader("Content-Type", "text/html")
      response.end(scenario.html(path))
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))

    try {
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
      const panel = await extension.context.newPage()
      await panel.goto(
        `chrome-extension://${extension.extensionId}/sidepanel.html`
      )
      const page = await extension.context.newPage()
      fixturePage = page
      await page.goto(origin)
      await panel.evaluate(
        async ({ origin, model, hosted }) => {
          const providerId = hosted ? "custom:openai:agent-fixture" : "ollama"
          await chrome.storage.sync.set({
            llm_providers_config_v1: JSON.stringify([
              {
                id: providerId,
                type: hosted ? "openai" : "ollama",
                name: hosted ? "Hosted acceptance" : "Fixture Ollama",
                enabled: true,
                baseUrl: hosted ? `${origin}/v1` : origin
              }
            ]),
            "provider-selected-model-ref": JSON.stringify({
              providerId,
              modelId: model
            })
          })
        },
        { origin, model, hosted: Boolean(liveModel) }
      )
      await panel.reload()
      await page.bringToFront()
      await panel.exposeFunction(
        "recordAgentMessage",
        (message: AgentPanelMessage) => messages.push(message)
      )
      await panel.evaluate(
        async ({ origin }) => {
          const tab = (await chrome.tabs.query({})).find((tab) =>
            tab.url?.startsWith(origin)
          )
          if (!tab?.id) throw new Error("Fixture tab is missing")
          const port = chrome.runtime.connect({ name: "agent-run-port" })
          ;(window as unknown as { agentPort: unknown }).agentPort = port
          port.onMessage.addListener((message) => {
            void (
              window as unknown as {
                recordAgentMessage(message: unknown): Promise<void>
              }
            ).recordAgentMessage(message)
            if (message.snapshot?.pending?.kind === "approval") {
              port.postMessage({
                type: "agent_approve",
                runId: message.snapshot.run.id,
                requestId: message.snapshot.pending.request.id
              })
            }
          })
        },
        { origin }
      )
      await panel
        .getByRole("button", { name: "Skip for now", exact: true })
        .click({ timeout: 10_000 })
        .catch(() => {})
      await panel.getByRole("tab", { name: /Agent/ }).click({ timeout: 10_000 })
      await panel
        .getByRole("textbox", { name: "What should Agent do?" })
        .fill(scenario.goal)
      await panel
        .getByRole("button", { name: "Start Agent", exact: true })
        .click()

      try {
        await expect
          .poll(
            () =>
              messages.filter((m) => m.type === "agent_snapshot").at(-1)
                ?.snapshot.run?.status,
            { timeout: liveModel ? 200_000 : 30_000 }
          )
          .toBe(scenario.status)
        await scenario.verify({
          page,
          panel,
          snapshot: messages.filter((m) => m.type === "agent_snapshot").at(-1)
            ?.snapshot,
          messages,
          wire,
          effects: () => effects
        })
      } finally {
        await testInfo.attach("agent-phases", {
          body: JSON.stringify(phases, null, 2),
          contentType: "application/json"
        })
        await testInfo.attach("agent-panel-trace", {
          body: JSON.stringify(messages, null, 2),
          contentType: "application/json"
        })
        await testInfo.attach("agent-fixture-model-wire", {
          body: JSON.stringify(wire, null, 2),
          contentType: "application/json"
        })
      }
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
}

/** The first observation the scripted model was given, for perception assertions. */
export const firstObservation = (
  wire: AgentScenarioOutcome["wire"]
): AgentFixtureObservation =>
  readObservation(wire[0]?.request as { messages: { content: string }[] })
