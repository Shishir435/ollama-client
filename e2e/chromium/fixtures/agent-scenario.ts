import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import type {
  AgentPanelMessage,
  AgentPanelSnapshot
} from "@ollama-client/contracts"
import type { Dialog, Page } from "@playwright/test"

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

/**
 * The observation as the model receives it: projected, so a field at its
 * default is absent rather than present and false.
 */
export interface AgentFixtureElement {
  ref: string
  tag: string
  role?: string
  name?: string
  type?: string
  value?: string
  scroll?: {
    x: number
    y: number
    documentHeight: number
    viewportHeight: number
  }
  checked?: boolean
  focused?: boolean
  href?: string
  group?: string
  submits?: boolean
  editable?: boolean
  multiline?: boolean
  draggable?: boolean
  sensitive?: boolean
  disabled?: boolean
  hidden?: boolean
  /** A cover sits over it, so a click would land on whatever is on top. */
  occluded?: boolean
}

export interface AgentFixtureObservation {
  url: string
  title: string
  text: string
  textPage?: {
    text: string
    offset: number
    nextOffset?: number
    frameId: number
  }
  documentText?: string
  documentTextTruncated?: boolean
  modals?: { id: string; kind: string; label?: string }[]
  /** Child frames the page holds, with whether the run was able to read each. */
  frames?: { frameId: number; origin: string; access: string }[]
  /** Regions the overview left out, so a task can inspect one by name. */
  omittedByGroup?: { group: string; count: number }[]
  /** Set when the inspect or find this observation answers matched nothing. */
  unmatched?: { region?: string; query?: string; regions?: string[] }
  dialogs?: { id: string; type: string; message: string }[]
  elements: AgentFixtureElement[]
}

export interface AgentScenarioContext {
  userAnswers?: { text: string; question?: string }[]
  /** 1 for the first decision the scripted model answers. */
  step: number
  page: Page
  /** Images attached to the request the scripted model is answering. */
  images: number
  /** The action names the request's tool schema offered. */
  actions: string[]
  /** The attached screenshot's pixel size, as the prompt describes it. */
  screenshot?: { width: number; height: number }
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
  /** Structural run trace lines the worker logged, oldest first. */
  phases: readonly Record<string, unknown>[]
  /** Which input backend this pass ran on, from the project that ran it. */
  backend: string
  /** 1 for the first run of this task, so a repeated pass can be told apart. */
  attempt: number
  /**
   * When this attempt began, in epoch milliseconds.
   *
   * Taken here rather than where a task is declared: a closure initialised at
   * module load measures from module load, so every first attempt in a pass
   * was reported as having taken as long as everything before it.
   */
  startedAt: number
  /** Tokens the provider reported, when it reports any; a fixture reports none. */
  tokens: { prompt: number; completion: number } | undefined
}

export interface AgentScenario {
  /**
   * How the panel answers an approval. `run_origin` widens it to the origin
   * for the rest of the run, which is what a user checking the box does.
   */
  approvalScope?: "once" | "run_origin"
  /** What the panel's textarea replies with, when the run asks something. */
  answer?: string
  /**
   * Left off the `@critical` gate. A benchmark scenario records what happened
   * rather than asserting a threshold, so a gate that ran it would be
   * measuring rather than gating.
   */
  gated?: boolean
  /** Names the test and the scenario in its attachments. */
  name: string
  goal: string
  /** The terminal run status the scenario is finished at. */
  status: "completed" | "paused" | "failed"
  /** Included in the hosted-model matrix, which only runs a couple of tasks. */
  hosted?: boolean
  /** The fixture model reports itself as reading images. */
  vision?: boolean
  timeoutMs?: number
  html(path: string): string
  navigationDelayMs?(path: string): number
  /**
   * Whether the goal is actually met, judged from the page rather than from
   * what the run claimed.
   *
   * Measuring false completion means the run's own verdict cannot be the
   * scorer. `verify` throws and therefore gates; this answers and therefore
   * measures, so a benchmark can count a run that reported success on a page
   * that never changed.
   */
  succeeded?(outcome: AgentScenarioOutcome): Promise<boolean> | boolean
  /** How many times to run this task. Repeats mean something for a live model. */
  attempts?: number
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

/**
 * Tokens the provider charged for the whole run.
 *
 * Read from the responses rather than estimated: Ollama reports
 * `prompt_eval_count` and `eval_count` per call, and a run's cost is their
 * sum across its decisions. A scripted fixture reports neither, so the answer
 * is `undefined` rather than zero — nothing was measured, which is not the
 * same as nothing being spent.
 */
export const reportedTokens = (
  wire: readonly { response?: string }[]
): { prompt: number; completion: number } | undefined => {
  let prompt = 0
  let completion = 0
  let seen = false
  for (const entry of wire) {
    if (!entry.response) continue
    for (const line of entry.response.split("\n")) {
      if (!line.trim()) continue
      try {
        const frame = JSON.parse(line) as {
          prompt_eval_count?: unknown
          eval_count?: unknown
        }
        if (typeof frame.prompt_eval_count === "number") {
          prompt += frame.prompt_eval_count
          seen = true
        }
        if (typeof frame.eval_count === "number") {
          completion += frame.eval_count
          seen = true
        }
      } catch {
        /* A non-JSON line is an SSE frame or a blank; neither carries counts. */
      }
    }
  }
  return seen ? { prompt, completion } : undefined
}

export const runAgentScenario = (scenario: AgentScenario): void => {
  const attempts = Math.max(1, scenario.attempts ?? 1)
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    runAgentScenarioAttempt(scenario, attempt, attempts)
  }
}

const runAgentScenarioAttempt = (
  scenario: AgentScenario,
  attempt: number,
  attempts: number
): void => {
  /** Synthetic page data only. No user profile or credentials enter this harness. */
  const suffix = attempts > 1 ? ` attempt ${attempt}` : ""
  const title =
    scenario.gated === false
      ? `Agent ${scenario.name}${suffix} through production boundaries`
      : `@critical Agent ${scenario.name}${suffix} through production boundaries`
  test(title, async ({ extension }, testInfo) => {
    const startedAt = Date.now()
    const liveModel = process.env.AGENT_HOSTED_MODEL
    const useHostedWire =
      Boolean(liveModel) && process.env.AGENT_HOSTED_WIRE !== "ollama"
    /**
     * Where a live pass sends its decisions: the olc proxy by default, since
     * that is what the hosted matrix was written against, and Ollama directly
     * when a pass wants the provider the extension treats as primary.
     */
    const liveBaseUrl =
      process.env.AGENT_HOSTED_BASE_URL ?? "http://127.0.0.1:8084"
    test.setTimeout(liveModel ? 240_000 : (scenario.timeoutMs ?? 60_000))
    /**
     * The live matrix runs a couple of the gated tasks, not all of them — one
     * real model against the whole critical suite is minutes per scenario for
     * no extra signal. The benchmark is the opposite: a live pass is the
     * entire point of it, and skipping those left the documented hosted
     * workflow recording nothing and writing no report at all.
     */
    test.skip(
      Boolean(liveModel) &&
        scenario.gated !== false &&
        scenario.hosted !== true,
      "Live model matrix uses form and delayed navigation tasks"
    )

    const dialogs: Dialog[] = []
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
      const upstream = await fetch(`${liveBaseUrl}${path}`, {
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
      const lastMessage = parsed.messages?.at(-1) as
        | { images?: unknown[] }
        | undefined
      const actions: string[] =
        parsed.tools?.[0]?.function?.parameters?.properties?.type?.enum ?? []
      const envelope = JSON.parse(parsed.messages.at(-1)?.content ?? "{}") as {
        userAnswers?: { text: string; question?: string }[]
        screenshot?: { width: number; height: number }
      }
      const decision = await scenario.decide(readObservation(parsed), {
        step,
        page: fixturePage as Page,
        images: lastMessage?.images?.length ?? 0,
        actions,
        ...(envelope.userAnswers ? { userAnswers: envelope.userAnswers } : {}),
        ...(envelope.screenshot ? { screenshot: envelope.screenshot } : {})
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
        return JSON.stringify({
          capabilities: [
            "completion",
            "tools",
            ...(scenario.vision ? ["vision"] : [])
          ]
        })
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
      /** Playwright otherwise dismisses native dialogs before the extension can answer. */
      if (testInfo.project.metadata.agentDomBackend !== true)
        page.on("dialog", (dialog) => dialogs.push(dialog))
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
        { origin, model, hosted: useHostedWire }
      )
      await panel.reload()
      await page.bringToFront()
      await panel.exposeFunction(
        "recordAgentMessage",
        (message: AgentPanelMessage) => messages.push(message)
      )

      await panel.evaluate(
        async ({ origin, approvalScope, answer }) => {
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
                requestId: message.snapshot.pending.request.id,
                ...(approvalScope === "run_origin"
                  ? { scope: approvalScope }
                  : {})
              })
            }
            const question = message.snapshot?.run?.question
            if (question && answer) {
              port.postMessage({
                type: "agent_answer",
                runId: message.snapshot.run.id,
                requestId: question.id,
                text: answer
              })
            }
          })
        },
        {
          origin,
          approvalScope: scenario.approvalScope,
          answer: scenario.answer
        }
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
            () => {
              const status = messages
                .filter((m) => m.type === "agent_snapshot")
                .at(-1)?.snapshot.run?.status
              return (
                status === scenario.status ||
                status === "failed" ||
                status === "cancelled"
              )
            },
            { timeout: liveModel ? 200_000 : 30_000 }
          )
          .toBe(true)
          .then(() =>
            expect(
              messages.filter((m) => m.type === "agent_snapshot").at(-1)
                ?.snapshot.run?.status
            ).toBe(scenario.status)
          )
          .catch((error: unknown) => {
            /**
             * A gate fails here; a measurement records instead. A benchmark
             * task that did not reach its expected status is a result — the
             * most interesting one — and throwing would leave it out of the
             * report entirely, so the pass would look better than it was.
             */
            if (scenario.gated === false) return
            const last = messages
              .filter((m) => m.type === "agent_snapshot")
              .at(-1)?.snapshot
            throw new Error(
              `${(error as Error).message}\nrun: ${JSON.stringify(last?.run?.error)}\nsteps: ${JSON.stringify(
                last?.steps.map((step) => [step.status, step.command?.type])
              )}`
            )
          })
        await scenario.verify({
          page,
          panel,
          snapshot: messages.filter((m) => m.type === "agent_snapshot").at(-1)
            ?.snapshot,
          messages,
          wire,
          effects: () => effects,
          backend:
            (testInfo.project.metadata.agentBenchmarkBackend as
              | string
              | undefined) ?? "unknown",
          attempt,
          startedAt,
          tokens: reportedTokens(wire),
          phases: phases.flatMap((line) =>
            Array.isArray(line)
              ? line.filter(
                  (part): part is Record<string, unknown> =>
                    typeof part === "object" && part !== null && "phase" in part
                )
              : []
          )
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
      // A failed run may leave a native prompt held; release it before failure screenshots.
      await Promise.all(
        dialogs.map((dialog) => dialog.dismiss().catch(() => {}))
      )
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

/**
 * Every observation the scripted model was given, oldest first. The first one
 * cannot answer a request the model had not made yet, so anything about how a
 * read-only request is answered has to be read from a later one.
 */
export const observations = (
  wire: AgentScenarioOutcome["wire"]
): AgentFixtureObservation[] =>
  wire
    .map((entry) =>
      readObservation(entry.request as { messages: { content: string }[] })
    )
    .filter((observation) => observation !== undefined)
