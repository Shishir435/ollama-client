import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import type {
  AgentCompletionCheck,
  AgentPanelMessage,
  AgentPanelSnapshot
} from "@ollama-client/contracts"
import type { Dialog, Page } from "@playwright/test"

import { hostedBenchmarkReasoningEffort } from "../benchmark/benchmark-config"
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
  /**
   * The answer to a multi-query `extract`: one group per question, in the
   * order asked, each naming the refs that answered it across every frame the
   * run was able to read.
   */
  lookup?: { query: string; refs: string[]; truncated?: boolean }[]
  /** The answer to a scoped read, when the observation was taken for one. */
  scope?: {
    kind: "query" | "region"
    value: string
    offset: number
    returned: number
    nextOffset?: number
  }
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
  screenshot?: {
    width: number
    height: number
    frames?: {
      frameId: number
      region: { x: number; y: number; width: number; height: number }
    }[]
    frameLimitations?: { frameId: number; reason: string }[]
  }
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
  /** Completion reviews the scripted reviewer answered. */
  reviews: () => number
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
  /** The user-facing chat response when the model reads with current_tab. */
  chatResponse?: string
  /** User-facing model turns, kept separate from the browser agent's decisions. */
  chatWire?: AgentScenarioOutcome["wire"]
  /** Count of user-facing model calls, including calls that returned tools. */
  chatModelCalls?: number
  /** Names of chat tools called before the supervised run, if any. */
  chatToolCalls?: string[]
  /** True when chat answered without starting a supervised browser run. */
  directChatResponse?: boolean
  /** Product-level terminal state when a run does not expose AgentPanelSnapshot. */
  terminalStatus?: string
  /** Product path used to handle this benchmark task, including a declined run start. */
  executionPath?: string
  /** Main-frame navigations and browser-history traversals observed on the fixture. */
  navigationEvents?: readonly AgentScenarioNavigationEvent[]
}

export interface AgentScenarioNavigationEvent {
  path: string
  kind: "document" | "history_traversal"
}

export interface AgentScenario {
  /**
   * What the scripted model answers the planning call with, if anything.
   *
   * Scenarios testing the completion gate declare their exact requirements.
   * Older scenarios default to one change requirement and the fixture supplies
   * its matching completion outcome; their `verify` callback independently
   * proves the page result, while every run still exercises a valid plan.
   */
  plan?: readonly {
    text: string
    kind: "change" | "read"
    check?: AgentCompletionCheck
  }[]
  /**
   * The scripted independent reviewer, given the evidence records it was
   * shown. Absent means it supports nothing, which leaves the judge's own
   * refusal in place.
   */
  review?: (
    evidence: readonly { id: string; quote?: string; for?: string }[]
  ) => readonly {
    id: string
    verdict: "supported" | "contradicted" | "insufficient_evidence"
    sources: readonly string[]
  }[]
  /**
   * How the panel answers an approval. `run_origin` widens it to the origin
   * for the rest of the run, which is what a user checking the box does.
   */
  approvalScope?: "once" | "run_origin"
  allowRoutineActions?: boolean
  /** What the panel's textarea replies with, when the run asks something. */
  answer?: string
  /** Match this wording in scripted runs; live models may phrase it differently. */
  answerQuestion?: string
  /** Hold an answer long enough to exercise intermediate-pause handling. */
  answerDelayMs?: number
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
  status: "completed" | "partial" | "paused" | "failed"
  /** Assert that an unsupported semantic outcome is explicitly deferred. */
  completionReview?: boolean
  /** Included in the hosted-model matrix, which only runs a couple of tasks. */
  hosted?: boolean
  /** The fixture model reports itself as reading images. */
  vision?: boolean
  timeoutMs?: number
  html(path: string): string
  redirect?(path: string): string | undefined
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
  /** Content-free benchmark diagnostics, persisted outside the product build. */
  diagnosticTrace?: (event: Record<string, unknown>) => void
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

/** Supply the bookkeeping older one-requirement fixture scripts predate. */
const normalizeScriptedDecision = (
  scenario: AgentScenario,
  scripted: unknown
): unknown => {
  if (
    typeof scripted !== "object" ||
    scripted === null ||
    !("type" in scripted)
  )
    return scripted
  if (
    scripted.type === "complete" &&
    (scenario.plan?.length ?? 1) === 1 &&
    !("outcomes" in scripted)
  ) {
    return {
      ...scripted,
      outcomes: [
        {
          id: "r1",
          met: true,
          ...("evidence" in scripted && typeof scripted.evidence === "string"
            ? { evidence: scripted.evidence }
            : {})
        }
      ]
    }
  }
  if (
    (scenario.plan?.length ?? 1) === 1 &&
    scripted.type !== "complete" &&
    !("requirementId" in scripted)
  )
    return { ...scripted, requirementId: "r1" }
  return scripted
}

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

/** Pull only visible text and tool names from a hosted chat stream. */
const readChatStream = (
  body: string
): { text: string; toolNames: string[] } => {
  let text = ""
  const toolNames = new Set<string>()
  const frames = body
    .split(/\r?\n/)
    .map((line) =>
      line.startsWith("data:") ? line.slice("data:".length).trim() : line.trim()
    )
    .filter((line) => line && line !== "[DONE]")
  for (const frame of frames) {
    try {
      const parsed = JSON.parse(frame) as {
        message?: {
          content?: unknown
          tool_calls?: { function?: { name?: unknown } }[]
        }
        choices?: {
          delta?: {
            content?: unknown
            tool_calls?: { function?: { name?: unknown } }[]
          }
          message?: {
            content?: unknown
            tool_calls?: { function?: { name?: unknown } }[]
          }
        }[]
      }
      const messages = [
        parsed.message,
        ...(parsed.choices ?? []).map(
          (choice) => choice.delta ?? choice.message
        )
      ]
      for (const message of messages) {
        if (typeof message?.content === "string") text += message.content
        for (const tool of message?.tool_calls ?? []) {
          if (typeof tool.function?.name === "string")
            toolNames.add(tool.function.name)
        }
      }
    } catch {
      /* Non-JSON SSE frames carry no completion text. */
    }
  }
  return { text: text.trim(), toolNames: [...toolNames] }
}

const toolNamesFromRequest = (request: unknown): string[] => {
  if (typeof request !== "object" || request === null) return []
  const tools = (request as { tools?: unknown }).tools
  if (!Array.isArray(tools)) return []
  return [
    ...new Set(
      tools.flatMap((tool) => {
        if (typeof tool !== "object" || tool === null) return []
        const name = (tool as { function?: { name?: unknown } }).function?.name
        return typeof name === "string" && /^[a-zA-Z0-9_:-]{1,80}$/.test(name)
          ? [name]
          : []
      })
    )
  ]
}

const toolNamesFromResponse = (body: string): string[] => {
  const streamed = readChatStream(body).toolNames
  if (streamed.length > 0) return streamed
  try {
    const parsed = JSON.parse(body) as {
      message?: { tool_calls?: { function?: { name?: unknown } }[] }
      choices?: {
        message?: { tool_calls?: { function?: { name?: unknown } }[] }
      }[]
    }
    const names = [
      ...(parsed.message?.tool_calls ?? []),
      ...(parsed.choices ?? []).flatMap(
        (choice) => choice.message?.tool_calls ?? []
      )
    ].flatMap((tool) => {
      const name = tool.function?.name
      return typeof name === "string" && /^[a-zA-Z0-9_:-]{1,80}$/.test(name)
        ? [name]
        : []
    })
    return [...new Set(names)]
  } catch {
    return []
  }
}

const providerErrorCode = (body: string): string | undefined => {
  try {
    const parsed = JSON.parse(body) as {
      error?: { code?: unknown; type?: unknown }
      code?: unknown
      type?: unknown
    }
    const candidate =
      parsed.error?.code ?? parsed.error?.type ?? parsed.code ?? parsed.type
    return typeof candidate === "string" &&
      /^[a-zA-Z0-9_.-]{1,80}$/.test(candidate)
      ? candidate
      : undefined
  } catch {
    return undefined
  }
}

const finishReasonFromResponse = (body: string): string | undefined => {
  const frames = body
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .filter((line) => line && line !== "[DONE]")
  for (const frame of [...frames].reverse()) {
    try {
      const parsed = JSON.parse(frame) as {
        choices?: { finish_reason?: unknown }[]
      }
      const candidate = parsed.choices?.[0]?.finish_reason
      if (
        typeof candidate === "string" &&
        /^[a-zA-Z0-9_.:-]{1,80}$/.test(candidate)
      )
        return candidate
    } catch {
      /* A non-JSON stream frame carries no finish reason. */
    }
  }
  try {
    const parsed = JSON.parse(body) as {
      done_reason?: unknown
      choices?: { finish_reason?: unknown }[]
    }
    const candidate = parsed.choices?.[0]?.finish_reason ?? parsed.done_reason
    return typeof candidate === "string" &&
      /^[a-zA-Z0-9_.:-]{1,80}$/.test(candidate)
      ? candidate
      : undefined
  } catch {
    return undefined
  }
}

const agentTraceEvent = (
  part: Record<string, unknown>
): Record<string, unknown> => {
  const fields = [
    "phase",
    "status",
    "from",
    "to",
    "action",
    "outcome",
    "risk",
    "authorization",
    "backend",
    "inputDelivery",
    "kind",
    "reason",
    "step",
    "elements",
    "claimed",
    "transitioned",
    "screenshot",
    "visual"
  ] as const
  const event: Record<string, unknown> = { type: "agent_phase" }
  for (const key of fields) {
    const value = part[key]
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    )
      event[key] = value
  }
  return event
}

/** A chat turn, as opposed to one of a run's own planning or decision calls. */
const isChatTurn = (parsed: unknown): boolean =>
  toolNamesFromRequest(parsed).includes("browser_task")

const executionPathFor = (
  agentStarted: boolean,
  chatToolCalls: Iterable<string>
): string => {
  if (agentStarted) return "browser_task"
  const calls = new Set(chatToolCalls)
  if (calls.has("current_tab")) return "current_tab"
  if (calls.has("read_tab")) return "read_tab"
  if (calls.has("browser_task")) return "browser_task_not_started"
  return "chat"
}

interface HostedChatState {
  wire: AgentScenarioOutcome["wire"]
  modelCalls: number
  response: string
  directResponse: boolean
  toolCalls: Set<string>
}

const isChatRequestPath = (path: string): boolean =>
  path === "/api/chat" || path === "/v1/chat/completions"

const parseRequestObject = (body: string): Record<string, unknown> | null => {
  if (!body.trim()) return null
  try {
    const parsed: unknown = JSON.parse(body)
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    // Forward malformed JSON unchanged so the upstream owns the HTTP error.
    return null
  }
}

const modelRouteFor = (
  path: string,
  chatRequest: boolean,
  chatTurn: boolean,
  requestTools: string[]
): string => {
  if (chatTurn) return "chat_turn"
  if (requestTools.includes("agent_plan")) return "agent_plan"
  if (requestTools.includes("agent_completion_review"))
    return "agent_completion_review"
  if (requestTools.includes("agent_decision")) return "agent_decision"
  if (path === "/api/tags" || path === "/v1/models") return "catalog"
  if (path === "/api/show") return "model_metadata"
  return chatRequest ? "other_chat" : "provider_request"
}

const modelFailureClass = (error: unknown): string => {
  if (error instanceof Error && error.name === "AbortError") return "aborted"
  if (error instanceof TypeError) return "network"
  return "request_error"
}

const recordHostedChatTurn = (input: {
  path: string
  parsedRequest: Record<string, unknown> | null
  chatTurn: boolean
  responseBody: string
  state: HostedChatState
}): void => {
  if (!isChatRequestPath(input.path) || !input.parsedRequest || !input.chatTurn)
    return

  input.state.modelCalls += 1
  const chat = readChatStream(input.responseBody)
  for (const toolName of chat.toolNames) input.state.toolCalls.add(toolName)
  // current_tab is read-only: its answer does not start a supervised run.
  if (chat.toolNames.length === 0 && chat.text) {
    input.state.response = chat.text
    input.state.directResponse = true
  }
}

const createHostedModelForwarder =
  (input: {
    scenario: AgentScenario
    attempt: number
    baseUrl: string
    wire: AgentScenarioOutcome["wire"]
    chatState: HostedChatState
  }) =>
  async (
    path: string,
    method: string | undefined,
    body: string
  ): Promise<{ status: number; body: string }> => {
    const chatRequest = isChatRequestPath(path)
    const parsedRequest = chatRequest ? parseRequestObject(body) : null
    const chatTurn = parsedRequest !== null && isChatTurn(parsedRequest)
    const requestTools = toolNamesFromRequest(parsedRequest)
    const modelRoute = modelRouteFor(path, chatRequest, chatTurn, requestTools)
    const requestStartedAt = Date.now()
    input.scenario.diagnosticTrace?.({
      type: "model_call_started",
      attempt: input.attempt,
      modelRoute,
      requestTools,
      requestBytes: Buffer.byteLength(body)
    })

    let upstream: Response
    let responseBody: string
    try {
      upstream = await fetch(`${input.baseUrl}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body ? { body } : {})
      })
      responseBody = await upstream.text()
    } catch (error) {
      input.scenario.diagnosticTrace?.({
        type: "model_call_failed",
        attempt: input.attempt,
        modelRoute,
        durationMs: Date.now() - requestStartedAt,
        failureClass: modelFailureClass(error)
      })
      throw error
    }

    const responseTools = toolNamesFromResponse(responseBody)
    input.scenario.diagnosticTrace?.({
      type: "model_call_completed",
      attempt: input.attempt,
      modelRoute,
      httpStatus: upstream.status,
      durationMs: Date.now() - requestStartedAt,
      requestBytes: Buffer.byteLength(body),
      responseBytes: Buffer.byteLength(responseBody),
      finishReason: finishReasonFromResponse(responseBody),
      requestTools,
      responseTools,
      ...(upstream.ok
        ? {}
        : { providerErrorCode: providerErrorCode(responseBody) })
    })
    if (chatRequest && parsedRequest && !chatTurn)
      input.wire.push({ request: parsedRequest, response: responseBody })
    if (chatRequest && parsedRequest && chatTurn)
      input.chatState.wire.push({
        request: parsedRequest,
        response: responseBody
      })
    recordHostedChatTurn({
      path,
      parsedRequest,
      chatTurn,
      responseBody,
      state: input.chatState
    })
    return { status: upstream.status, body: responseBody }
  }

type AgentSnapshot = Extract<
  AgentPanelMessage,
  { type: "agent_snapshot" }
>["snapshot"]

interface AgentMessageTraceContext {
  scenario: AgentScenario
  attempt: number
  runState: { lastRunState: string }
  seenStepReceipts: Map<string, string>
  seenApprovalRequests: Set<string>
  seenTakeoverRequests: Set<string>
  seenQuestions: Set<string>
}

const traceAgentRun = (
  snapshot: AgentSnapshot,
  context: AgentMessageTraceContext
): void => {
  const run = snapshot.run
  if (!run) return
  const runState = JSON.stringify([
    run.status,
    run.pauseReason,
    run.error?.code,
    run.stepCount,
    run.observationCount
  ])
  if (runState !== context.runState.lastRunState) {
    context.runState.lastRunState = runState
    context.scenario.diagnosticTrace?.({
      type: "agent_run_state",
      attempt: context.attempt,
      status: run.status,
      pauseReason: run.pauseReason,
      errorCode: run.error?.code,
      stepCount: run.stepCount,
      observationCount: run.observationCount,
      requirementCount: run.requirements?.length,
      requirementKinds: run.requirements?.map((requirement) => requirement.kind)
    })
  }
  if (run.question && !context.seenQuestions.has(run.question.id)) {
    context.seenQuestions.add(run.question.id)
    context.scenario.diagnosticTrace?.({
      type: "user_question",
      attempt: context.attempt,
      decision: "waiting_for_answer"
    })
  }
}

const traceAgentSteps = (
  snapshot: AgentSnapshot,
  context: AgentMessageTraceContext
): void => {
  for (const step of snapshot.steps) {
    const signature = JSON.stringify([
      step.status,
      step.command?.type,
      step.risk,
      step.verification?.outcome,
      step.verification?.evidence.kind
    ])
    if (context.seenStepReceipts.get(step.stepId) === signature) continue
    context.seenStepReceipts.set(step.stepId, signature)
    context.scenario.diagnosticTrace?.({
      type: "agent_step",
      attempt: context.attempt,
      sequence: step.sequence,
      status: step.status,
      action: step.command?.type,
      risk: step.risk,
      verificationOutcome: step.verification?.outcome,
      evidenceKind: step.verification?.evidence.kind,
      targetTag: step.target?.tag,
      hasTarget: Boolean(step.target),
      durationMs:
        step.startedAt === undefined
          ? undefined
          : Math.max(0, step.at - step.startedAt)
    })
  }
}

const traceAgentPending = (
  snapshot: AgentSnapshot,
  context: AgentMessageTraceContext
): void => {
  const pending = snapshot.pending
  if (pending?.kind === "approval") {
    const request = pending.request
    if (context.seenApprovalRequests.has(request.id)) return
    context.seenApprovalRequests.add(request.id)
    const step = snapshot.steps.find(
      (candidate) => candidate.stepId === request.stepId
    )
    context.scenario.diagnosticTrace?.({
      type: "approval_requested",
      attempt: context.attempt,
      sequence: step?.sequence,
      action: step?.command?.type,
      risk: request.risk,
      grantable: request.grantable,
      originPresent: request.origin !== undefined
    })
    context.scenario.diagnosticTrace?.({
      type: "approval_response",
      attempt: context.attempt,
      approvalAnswer: "approve",
      approvalScope: context.scenario.approvalScope ?? "once"
    })
    return
  }
  if (pending?.kind !== "takeover") return
  if (context.seenTakeoverRequests.has(pending.request.id)) return
  context.seenTakeoverRequests.add(pending.request.id)
  context.scenario.diagnosticTrace?.({
    type: "supervision_requested",
    attempt: context.attempt,
    decision: "takeover",
    reason: pending.request.reason
  })
}

const recordAgentPanelMessage = (
  message: AgentPanelMessage,
  messages: AgentPanelMessage[],
  context: AgentMessageTraceContext
): void => {
  messages.push(message)
  if (message.type === "agent_command_failed") {
    context.scenario.diagnosticTrace?.({
      type: "agent_command_failed",
      attempt: context.attempt,
      action: message.command,
      errorCode: message.messageKey
    })
    return
  }
  if (message.type !== "agent_snapshot") return
  traceAgentRun(message.snapshot, context)
  traceAgentSteps(message.snapshot, context)
  traceAgentPending(message.snapshot, context)
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
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This callback owns the complete extension-run lifecycle; provider forwarding and message tracing are split into helpers above.
  test(title, async ({ extension }, testInfo) => {
    const startedAt = Date.now()
    const liveModel = process.env.AGENT_HOSTED_MODEL
    const answerQuestion = liveModel ? undefined : scenario.answerQuestion
    scenario.diagnosticTrace?.({
      type: "scenario_started",
      attempt,
      model: liveModel || "fixture-agent",
      fixtureData: true
    })
    const useHostedWire =
      Boolean(liveModel) && process.env.AGENT_HOSTED_WIRE !== "ollama"
    const hostedReasoningEffort = hostedBenchmarkReasoningEffort()
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
    let reviews = 0
    let step = 0
    const phases: unknown[] = []
    const wire: AgentScenarioOutcome["wire"] = []
    const messages: AgentPanelMessage[] = []
    const seenStepReceipts = new Map<string, string>()
    const seenApprovalRequests = new Set<string>()
    const seenTakeoverRequests = new Set<string>()
    const seenQuestions = new Set<string>()
    const runTraceState = { lastRunState: "" }
    const chatState: HostedChatState = {
      wire: [],
      modelCalls: 0,
      response: "",
      directResponse: false,
      toolCalls: new Set()
    }
    let agentStarted = false
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
        if (!message.text().includes("Agent run trace")) return
        const lines = await Promise.all(
          message.args().map((arg) => arg.jsonValue())
        )
        phases.push(lines)
        for (const line of lines) {
          const parts = Array.isArray(line) ? line : [line]
          for (const part of parts) {
            if (
              typeof part === "object" &&
              part !== null &&
              "phase" in part &&
              typeof part.phase === "string"
            )
              scenario.diagnosticTrace?.(
                agentTraceEvent(part as Record<string, unknown>)
              )
          }
        }
      })
    }

    /** Forwarded verbatim when the matrix runs a real model behind the proxy. */
    const forwardToHostedModel = createHostedModelForwarder({
      scenario,
      attempt,
      baseUrl: liveBaseUrl,
      wire,
      chatState
    })

    /**
     * The planning call, answered without touching the step counter.
     *
     * A run asks the provider for two different things now, and the scripted
     * model answers by step index. Letting a plan request through here spent
     * a scripted step on it and shifted every later decision by one.
     */
    const answerPlan = () =>
      `${JSON.stringify({
        model,
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              function: {
                name: "agent_plan",
                arguments: {
                  /**
                   * Each entry quotes the goal as its source, as a planner
                   * is required to: an unsourced entry is refused.
                   */
                  requirements: (
                    scenario.plan ?? [{ text: scenario.goal, kind: "change" }]
                  ).map((entry) => ({ source: scenario.goal, ...entry }))
                }
              }
            }
          ]
        },
        done: true
      })}\n`

    /**
     * The independent completion review, answered off the step counter for
     * the same reason as planning. An empty answer supports nothing, so a
     * scenario that does not script a reviewer keeps the deterministic
     * judge's refusal exactly as it was before review existed.
     */
    const answerReview = (parsed: {
      messages?: { role?: string; content?: string }[]
    }) => {
      const prompt =
        parsed.messages?.find((message) => message.role === "user")?.content ??
        ""
      const data = prompt.slice(
        prompt.indexOf("<data>\n") + 7,
        prompt.lastIndexOf("\n</data>")
      )
      const evidence = (JSON.parse(data) as { evidence: [] }).evidence
      reviews += 1
      return `${JSON.stringify({
        model,
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              function: {
                name: "agent_completion_review",
                arguments: { verdicts: scenario.review?.(evidence) ?? [] }
              }
            }
          ]
        },
        done: true
      })}\n`
    }

    const answerDecision = async (body: string): Promise<string> => {
      const parsed = JSON.parse(body)
      if (isChatTurn(parsed)) return answerChatTurn(parsed)
      if (parsed.tools?.[0]?.function?.name === "agent_plan")
        return answerPlan()
      if (parsed.tools?.[0]?.function?.name === "agent_completion_review")
        return answerReview(parsed)
      step += 1
      const lastMessage = parsed.messages?.at(-1) as
        | { images?: unknown[] }
        | undefined
      const actions: string[] =
        parsed.tools?.[0]?.function?.parameters?.properties?.type?.enum ?? []
      const envelope = JSON.parse(parsed.messages.at(-1)?.content ?? "{}") as {
        userAnswers?: { text: string; question?: string }[]
        screenshot?: {
          width: number
          height: number
          frames?: {
            frameId: number
            region: { x: number; y: number; width: number; height: number }
          }[]
          frameLimitations?: { frameId: number; reason: string }[]
        }
      }
      const scriptedDecision = await scenario.decide(readObservation(parsed), {
        step,
        page: fixturePage as Page,
        images: lastMessage?.images?.length ?? 0,
        actions,
        ...(envelope.userAnswers ? { userAnswers: envelope.userAnswers } : {}),
        ...(envelope.screenshot ? { screenshot: envelope.screenshot } : {})
      })
      const decision = normalizeScriptedDecision(scenario, scriptedDecision)
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

    /**
     * The chat turn that delegates the task. A run starts only when the chat
     * model calls `browser_task`, so the scripted model does that with the
     * scenario's goal, and answers in prose once the run's record comes back.
     */
    const answerChatTurn = (parsed: {
      messages?: { role?: string }[]
    }): string =>
      `${JSON.stringify({
        model,
        message:
          parsed.messages?.at(-1)?.role === "tool"
            ? { role: "assistant", content: "The browser task has finished." }
            : {
                role: "assistant",
                content: "",
                tool_calls: [
                  {
                    function: {
                      name: "browser_task",
                      arguments: { goal: scenario.goal }
                    }
                  }
                ]
              },
        done: true
      })}\n`

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
      const redirect = scenario.redirect?.(path)
      if (redirect) {
        response.writeHead(303, { Location: redirect })
        response.end()
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
        async ({ origin, model, hosted, approveEach, reasoningEffort }) => {
          const providerId = hosted ? "custom:openai:agent-fixture" : "ollama"
          /**
           * Routine-action consent is a device-local preference now, and the
           * agent itself is opt-in: off, `browser_task` is never offered.
           */
          await chrome.storage.local.set({
            "agent-permission-mode-v1": JSON.stringify(
              approveEach ? "approve_each" : "allow_routine"
            ),
            "agent-enabled-v1": JSON.stringify(true)
          })
          await chrome.storage.sync.set({
            "agent-announcement-dismissed-v1": JSON.stringify(true),
            ...(reasoningEffort
              ? {
                  "provider-model-config": JSON.stringify({
                    [`${providerId}::${model}`]: {
                      reasoning_effort: reasoningEffort
                    }
                  })
                }
              : {}),
            ...(hosted
              ? {
                  // The live benchmark uses OLC's custom OpenAI-compatible
                  // endpoint. Seed the capability the OLC model catalog
                  // advertises so the chat can delegate into browser_task.
                  "provider-model-capability-overrides": JSON.stringify({
                    [`${providerId}::${model}`]: { toolCalling: true }
                  })
                }
              : {}),
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
        {
          origin,
          model,
          hosted: useHostedWire,
          reasoningEffort: hostedReasoningEffort,
          approveEach: scenario.allowRoutineActions !== true
        }
      )
      await panel.reload()
      await page.bringToFront()
      const messageTraceContext: AgentMessageTraceContext = {
        scenario,
        attempt,
        runState: runTraceState,
        seenStepReceipts,
        seenApprovalRequests,
        seenTakeoverRequests,
        seenQuestions
      }
      await panel.exposeFunction(
        "recordAgentMessage",
        (message: AgentPanelMessage) =>
          recordAgentPanelMessage(message, messages, messageTraceContext)
      )

      await panel.evaluate(
        async ({
          origin,
          approvalScope,
          answer,
          answerQuestion,
          answerDelayMs
        }) => {
          const tab = (await chrome.tabs.query({})).find((tab) =>
            tab.url?.startsWith(origin)
          )
          if (!tab?.id) throw new Error("Fixture tab is missing")
          const port = chrome.runtime.connect({ name: "agent-run-port" })
          const answeredQuestions = new Set<string>()
          ;(window as unknown as { agentPort: unknown }).agentPort = port
          port.onMessage.addListener((message: AgentPanelMessage) => {
            void (
              window as unknown as {
                recordAgentMessage(message: AgentPanelMessage): Promise<void>
              }
            ).recordAgentMessage(message)
            if (message.type !== "agent_snapshot") return
            const run = message.snapshot.run
            if (!run) return
            if (message.snapshot.pending?.kind === "approval") {
              port.postMessage({
                type: "agent_approve",
                runId: run.id,
                requestId: message.snapshot.pending.request.id,
                ...(approvalScope === "run_origin"
                  ? { scope: approvalScope }
                  : {})
              })
            }
            const question = run.question
            if (
              question &&
              answer &&
              (!answerQuestion || question.text === answerQuestion) &&
              !question.display?.some(
                (text) => text.key === "agent.question_text.completion_refused"
              ) &&
              !answeredQuestions.has(question.id)
            ) {
              answeredQuestions.add(question.id)
              setTimeout(
                () =>
                  port.postMessage({
                    type: "agent_answer",
                    runId: run.id,
                    requestId: question.id,
                    text: answer
                  }),
                answerDelayMs ?? 0
              )
            }
          })
        },
        {
          origin,
          approvalScope: scenario.approvalScope,
          answer: scenario.answer,
          answerQuestion,
          answerDelayMs: scenario.answerDelayMs
        }
      )
      await panel
        .getByRole("button", { name: "Skip for now", exact: true })
        .click({ timeout: 10_000 })
        .catch(() => {})
      /**
       * There is no Agent mode: the task is an ordinary chat message, the
       * chat model delegates it through `browser_task`, and the first run in
       * a chat is asked about before it starts.
       */
      await panel
        .getByRole("button", { name: "Start Chatting" })
        .click({ timeout: 10_000 })
        .catch(() => {})
      const composer = panel.getByPlaceholder("Type a message or ctrl + /")
      await composer.fill(scenario.goal)
      await composer.press("Enter")
      const allowForChat = panel.getByRole("button", {
        name: "Allow for this chat",
        exact: true
      })
      const runSeen = () =>
        messages.some(
          (message) =>
            message.type === "agent_snapshot" && Boolean(message.snapshot.run)
        )
      if (liveModel) {
        /**
         * Every card is answered, not only the first. A live chat model may
         * call another confirmation-gated tool — `capture_screenshot` is
         * medium risk — before it delegates, and answering only that card
         * left the `browser_task` card behind it unanswered: the run never
         * started and the attempt sat out the whole timeout as `not-started`.
         * A user saying yes to each card is the realistic stand-in; the run
         * having started, not a card having been clicked, is what makes the
         * attempt a supervised run.
         */
        let consents = 0
        await expect
          .poll(
            async () => {
              if (runSeen()) return true
              if ((await allowForChat.count()) > 0) {
                consents += 1
                scenario.diagnosticTrace?.({
                  type: "browser_task_consent",
                  attempt,
                  decision: "accepted",
                  sequence: consents
                })
                await allowForChat
                  .first()
                  .click({ timeout: 5_000 })
                  .catch(() => {})
                return false
              }
              return chatState.directResponse
            },
            { timeout: 120_000 }
          )
          .toBe(true)
        agentStarted = runSeen()
        if (!agentStarted && consents === 0) {
          scenario.diagnosticTrace?.({
            type: "browser_task_consent",
            attempt,
            decision: "not_requested"
          })
        }
      } else {
        scenario.diagnosticTrace?.({
          type: "browser_task_consent",
          attempt,
          decision: "accepted"
        })
        await allowForChat.click({ timeout: 20_000 })
        agentStarted = true
      }

      try {
        if (agentStarted) {
          await expect
            .poll(
              () => {
                const run = messages
                  .filter((m) => m.type === "agent_snapshot")
                  .at(-1)?.snapshot.run
                /**
                 * Any settled status ends the wait, not only the expected
                 * one. A run that settled `partial` or paused on something
                 * nothing here will answer used to be waited on for the full
                 * timeout, which put ~180 s of harness idle into every such
                 * row's wall time. A question the scenario scripts an answer
                 * for is not settled: the answer resumes it.
                 */
                const review =
                  run?.question?.display?.some(
                    (text) =>
                      text.key === "agent.question_text.completion_refused"
                  ) === true
                const answered = Boolean(
                  run?.question &&
                    scenario.answer &&
                    !review &&
                    (!answerQuestion || run.question.text === answerQuestion)
                )
                if (run?.status === "paused")
                  return scenario.completionReview ? review : !answered
                return (
                  run?.status === "completed" ||
                  run?.status === "partial" ||
                  run?.status === "failed" ||
                  run?.status === "cancelled"
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
        }
        const outcome: AgentScenarioOutcome = {
          page,
          panel,
          snapshot: messages.filter((m) => m.type === "agent_snapshot").at(-1)
            ?.snapshot,
          messages,
          wire,
          effects: () => effects,
          reviews: () => reviews,
          backend:
            (testInfo.project.metadata.agentBenchmarkBackend as
              | string
              | undefined) ?? "unknown",
          attempt,
          startedAt,
          tokens: reportedTokens([...wire, ...chatState.wire]),
          chatWire: chatState.wire,
          phases: phases.flatMap((line) =>
            Array.isArray(line)
              ? line.filter(
                  (part): part is Record<string, unknown> =>
                    typeof part === "object" && part !== null && "phase" in part
                )
              : []
          ),
          ...(chatState.response ? { chatResponse: chatState.response } : {}),
          chatModelCalls: chatState.modelCalls,
          chatToolCalls: [...chatState.toolCalls],
          directChatResponse: chatState.directResponse,
          executionPath: executionPathFor(agentStarted, chatState.toolCalls)
        }
        if (scenario.completionReview) {
          expect(outcome.snapshot?.run?.question?.display).toContainEqual(
            expect.objectContaining({
              key: "agent.question_text.completion_refused"
            })
          )
          expect(outcome.snapshot?.run?.result).toBeUndefined()
          expect(outcome.phases).toContainEqual(
            expect.objectContaining({
              phase: "completion_refused",
              reason: "needs_review"
            })
          )
        }
        await scenario.verify(outcome)
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
      const finalSnapshot = messages
        .filter((message) => message.type === "agent_snapshot")
        .at(-1)?.snapshot
      scenario.diagnosticTrace?.({
        type: "fixture_observed_end",
        attempt,
        executionPath: executionPathFor(agentStarted, chatState.toolCalls),
        status: finalSnapshot?.run?.status ?? "no_run_snapshot",
        pauseReason: finalSnapshot?.run?.pauseReason,
        errorCode: finalSnapshot?.run?.error?.code,
        stepCount: finalSnapshot?.run?.stepCount,
        observationCount: finalSnapshot?.run?.observationCount,
        modelCalls: wire.length + chatState.modelCalls,
        chatToolCalls: [...chatState.toolCalls],
        eventCount: messages.length
      })
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
