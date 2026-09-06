import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import type { AgentPanelMessage } from "@ollama-client/contracts"
import type { Page } from "@playwright/test"
import { expect, test } from "../../fixtures/extension"

const fixtureDecision = (observation: {
  visibleText: string
  elements: { tag: string; name?: string; value?: string; ref: string }[]
}) => {
  const name = observation.elements.find(
    (e: { tag: string }) => e.tag === "input"
  )
  const button = observation.elements.find(
    (e: { name?: string }) => e.name === "Continue" || e.name === "Details"
  )
  return observation.visibleText.includes("Status: Active")
    ? { type: "complete", summary: "Active" }
    : name && name.value !== "Alice"
      ? { type: "clear_and_type", ref: name?.ref, text: "Alice" }
      : { type: "click", ref: button?.ref }
}

const recordWire = (
  path: string,
  body: string,
  response: string,
  wire: unknown[]
) => {
  if (path === "/api/chat" || path === "/v1/chat/completions")
    wire.push({ request: JSON.parse(body), response })
}

type Scenario = "form" | "click" | "details" | "stale" | "uncertain"

const delayFixtureNavigation = async (scenario: Scenario, path: string) => {
  if (scenario === "details" && path.startsWith("/details"))
    await new Promise((resolve) => setTimeout(resolve, 1_500))
}

const fixtureHtml = (scenario: Scenario, path: string): string => {
  if (path.startsWith("/details"))
    return "<!doctype html><title>Details</title><main><h1>Details</h1><p>Status: Active</p></main>"
  if (scenario === "form")
    return '<!doctype html><title>Agent form</title><main><h1>Account</h1><form action="/details"><label for="name">Name</label><input id="name" name="name"><button>Continue</button></form></main>'
  if (scenario === "details")
    return '<!doctype html><title>Agent details</title><main><a href="/details">Details</a></main>'
  const change =
    scenario === "uncertain"
      ? ""
      : "document.querySelector('main').insertAdjacentHTML('beforeend','<p>Status: Active</p>');this.remove();"
  return `<!doctype html><title>Agent click</title><main><button type="button" onclick="fetch('/effect');${change}">Continue</button></main>`
}

for (const scenario of [
  "form",
  "click",
  "details",
  "stale",
  "uncertain"
] as const) {
  /** Synthetic page data only. No user profile or credentials enter this harness. */
  test(`@critical Agent ${scenario} through production boundaries`, async ({
    extension
  }, testInfo) => {
    test.setTimeout(process.env.AGENT_HOSTED_MODEL ? 240_000 : 60_000)
    test.skip(
      Boolean(process.env.AGENT_HOSTED_MODEL) &&
        scenario !== "form" &&
        scenario !== "details",
      "Live model matrix uses form and delayed navigation tasks"
    )
    let fixturePage: Page | undefined
    let replaced = false
    let effects = 0
    const phases: unknown[] = []
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
    const wire: unknown[] = []
    const liveModel = process.env.AGENT_HOSTED_MODEL
    const model = liveModel || "fixture-agent"
    const replaceTarget = async () => {
      if (scenario !== "stale" || replaced) return
      replaced = true
      await fixturePage?.evaluate(() => {
        const button = document.querySelector("button")
        button?.replaceWith(button.cloneNode(true))
      })
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
        if (liveModel) {
          const upstream = await fetch(`http://127.0.0.1:8084${path}`, {
            method: request.method,
            headers: { "Content-Type": "application/json" },
            ...(body ? { body } : {})
          })
          const text = await upstream.text()
          recordWire(path, body, text, wire)
          response.writeHead(upstream.status)
          response.end(text)
          return
        }
        if (path === "/api/tags") {
          response.end(
            JSON.stringify({
              models: [{ name: model, model, details: { family: "fixture" } }]
            })
          )
          return
        }
        if (path === "/api/show") {
          response.end(
            JSON.stringify({ capabilities: ["completion", "tools"] })
          )
          return
        }
        if (path === "/api/chat") {
          const parsed = JSON.parse(body)
          const prompt = JSON.parse(parsed.messages.at(-1).content)
          const observation = prompt.observation
          const decision = fixtureDecision(observation)
          await replaceTarget()
          wire.push({ request: parsed, decision })
          response.end(
            `${JSON.stringify({
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
          )
          return
        }
        response.end("{}")
        return
      }
      // Real sites acknowledge navigation before the document finishes loading.
      await delayFixtureNavigation(scenario, path)
      response.setHeader("Content-Type", "text/html")
      response.end(fixtureHtml(scenario, path))
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
      const messages: AgentPanelMessage[] = []
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
        { origin, model }
      )
      await panel
        .getByRole("button", { name: "Skip for now", exact: true })
        .click({ timeout: 10_000 })
        .catch(() => {})
      await panel.getByRole("tab", { name: /Agent/ }).click({ timeout: 10_000 })
      await panel
        .getByRole("textbox", { name: "What should Agent do?" })
        .fill(
          scenario === "form"
            ? "Enter Alice in the Name field, continue, and tell me the status."
            : scenario === "details"
              ? "Open Details and tell me the status."
              : "Click Continue and report the status."
        )
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
          .toBe(scenario === "uncertain" ? "paused" : "completed")
        if (scenario !== "uncertain")
          await expect(page.getByText("Status: Active")).toBeVisible()
        const final = messages
          .filter((m) => m.type === "agent_snapshot")
          .at(-1)?.snapshot
        if (scenario === "uncertain") {
          expect(final?.run?.pauseReason).toBe("unresolved_effect")
          await expect.poll(() => effects).toBe(1)
          expect(wire).toHaveLength(1)
          return
        }
        expect(final?.run?.result).toContain("Active")
        expect(final?.run?.observationCount).toBeGreaterThanOrEqual(
          scenario === "form" || scenario === "stale" ? 3 : 2
        )
        expect(
          final?.steps
            .filter((step) => step.status === "verified")
            .map((step) => step.command?.type)
        ).toEqual(
          scenario === "form"
            ? [expect.stringMatching(/^(type|clear_and_type)$/), "click"]
            : ["click"]
        )
        if (scenario === "stale") {
          expect(
            final?.steps.some(
              (step) => step.verification?.evidence.kind === "stale_target"
            )
          ).toBe(true)
          await expect.poll(() => effects).toBe(1)
        }
        expect(wire.length).toBeGreaterThanOrEqual(
          scenario === "form" || scenario === "stale" ? 3 : 2
        )
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
