import type {
  AgentFixtureElement,
  AgentFixtureObservation,
  AgentScenario,
  AgentScenarioOutcome
} from "../fixtures/agent-scenario"
import {
  agentFixtureElement,
  runAgentScenario
} from "../fixtures/agent-scenario"
import { test } from "../fixtures/extension"
import { runNanobrowserScenario } from "../fixtures/nanobrowser-scenario"
import type { AgentAttemptRecord } from "./agent-benchmark"
import {
  approvalsAsked,
  attemptTelemetry,
  countRepeatedTargets,
  createAgentBenchmarkTrace,
  recordAttempt
} from "./agent-benchmark"
import { benchmarkAttempts } from "./benchmark-counts"

/**
 * How a frozen evaluation task is declared and recorded.
 *
 * Separated from the tasks themselves so the two can be read for what they
 * are: this file is the instrument, and the suite beside it is the thing being
 * measured. A task states its goal, the page it runs against, the decisions a
 * scripted model makes, and — the part a gate does not have — a predicate that
 * reads the page to say whether the goal was actually met.
 */

export {
  benchmarkAttempts,
  benchmarkExpectedAttempts,
  benchmarkTaskCount
} from "./benchmark-counts"

export const benchmarkModel =
  process.env.AGENT_HOSTED_MODEL ??
  (process.env.AGENT_BENCHMARK_PRODUCT === "nanobrowser"
    ? "codex/gpt-6-luna"
    : "fixture-agent")

/** Make browser use explicit so the live task measures the agent, not a guess. */
export const benchmarkPrompt = (goal: string): string =>
  `Use the browser to complete this task: ${goal}`

export interface BenchmarkTask
  extends Pick<
    AgentScenario,
    | "goal"
    | "status"
    | "html"
    | "decide"
    | "succeeded"
    | "approvalScope"
    | "vision"
    | "answer"
    | "navigationDelayMs"
    | "hosted"
    | "plan"
  > {
  family: string
  name: string
}

/**
 * Records one attempt.
 *
 * Everything here is a count, a label or a boolean: no page text, no entered
 * text, no URL. A report that carried page content could not be attached to an
 * issue, which is the only reason to write one.
 */
export const recordBenchmarkAttempt = async (input: {
  attempts: AgentAttemptRecord[]
  family: string
  scenario: string
  outcome: AgentScenarioOutcome
  expectedStatus: string
  succeeded?: AgentScenario["succeeded"]
  diagnosticTrace?: (event: Record<string, unknown>) => void
}): Promise<void> => {
  const { outcome } = input
  const run = outcome.snapshot?.run
  const steps = outcome.snapshot?.steps ?? []
  const targets = countRepeatedTargets(steps)
  let met: boolean | undefined
  if (input.succeeded) {
    try {
      met = await input.succeeded(outcome)
    } catch {
      /** A predicate that cannot read the page has not proved the goal met. */
      met = false
      input.diagnosticTrace?.({
        type: "score_predicate_failed",
        attempt: outcome.attempt,
        scoreError: true
      })
    }
  }
  recordAttempt(input.attempts, {
    family: input.family,
    scenario: input.scenario,
    attempt: outcome.attempt,
    backend: outcome.backend,
    ...(outcome.executionPath ? { executionPath: outcome.executionPath } : {}),
    terminalStatus:
      run?.status ??
      outcome.terminalStatus ??
      (outcome.directChatResponse ? "completed" : "not-started"),
    expectedStatus: input.expectedStatus,
    ...(run?.pauseReason ? { pauseReason: run.pauseReason } : {}),
    ...(run?.error?.code ? { errorCode: run.error.code } : {}),
    steps: new Set(steps.map((step) => step.stepId)).size,
    observations: run?.observationCount ?? 0,
    modelCalls: outcome.wire.length + (outcome.chatModelCalls ?? 0),
    approvalsAsked: approvalsAsked(outcome.messages).length,
    approvalsGranted: run?.grants?.length ?? 0,
    repeatedTargets: targets.repeated,
    ambiguousTargets: targets.ambiguous,
    wallMs: Date.now() - input.outcome.startedAt,
    ...(met === undefined ? {} : { succeeded: met }),
    ...(met === undefined
      ? {}
      : {
          falseCompletion:
            (run?.status === "completed" ||
              outcome.terminalStatus === "completed" ||
              outcome.directChatResponse) &&
            !met
        }),
    /**
     * The steps' own durable telemetry first: it covers every provider rather
     * than one wire format, and it survives the worker restart that makes a
     * run worth measuring. The fixture wire stays as the fallback for a run
     * whose steps recorded nothing.
     */
    ...(outcome.tokens
      ? {
          promptTokens: outcome.tokens.prompt,
          completionTokens: outcome.tokens.completion
        }
      : {}),
    ...attemptTelemetry(steps),
    ...(run?.error?.code
      ? { firstLimitation: run.error.code }
      : run?.pauseReason
        ? { firstLimitation: run.pauseReason }
        : {})
  })
}

/**
 * Declares a task as an ungated scenario that records its outcome.
 *
 * `gated: false` is what makes a stalled run a result rather than a failed
 * test: the run that did not finish is the most interesting row in the table,
 * and throwing would leave it out and make the pass look better than it was.
 */
export const benchmarkTask = (
  attempts: AgentAttemptRecord[],
  task: BenchmarkTask,
  onRecorded?: (outcome: AgentScenarioOutcome) => void
): void => {
  const { family, name, succeeded, ...rest } = task
  const scenario = `${family}/${name}`
  const product =
    process.env.AGENT_BENCHMARK_PRODUCT === "nanobrowser"
      ? "nanobrowser"
      : "ollama-client"
  let trace: ReturnType<typeof createAgentBenchmarkTrace> | undefined
  let traceDisabled = false
  const diagnosticTrace = (event: Record<string, unknown>) => {
    if (traceDisabled) return
    try {
      if (!trace) {
        trace = createAgentBenchmarkTrace({
          product,
          scenario,
          model: benchmarkModel
        })
        console.info(`[agent-benchmark] diagnostic trace: ${trace.path}`)
      }
      trace.record(event)
    } catch {
      traceDisabled = true
      console.warn("[agent-benchmark] diagnostic trace could not be written")
    }
  }
  const runScenario =
    process.env.AGENT_BENCHMARK_PRODUCT === "nanobrowser"
      ? runNanobrowserScenario
      : runAgentScenario
  runScenario({
    ...rest,
    goal: benchmarkPrompt(task.goal),
    diagnosticTrace,
    ...(succeeded ? { succeeded } : {}),
    name: scenario,
    gated: false,
    attempts: benchmarkAttempts,
    async verify(outcome) {
      await recordBenchmarkAttempt({
        attempts,
        family,
        scenario,
        outcome,
        expectedStatus: task.status,
        diagnosticTrace,
        ...(succeeded ? { succeeded } : {})
      })
      /**
       * The answer text goes to the test's own attachments, never the trace:
       * traces are allowlisted to labels and counts so they can be shared,
       * and the report must carry no page text. Every page here is a
       * synthetic fixture, and without the text a false completion on the
       * read path cannot be told apart from a scorer that misread a correct
       * reply. The trace records only where the answer came from and its
       * length.
       */
      const answer = outcome.snapshot?.run?.result ?? outcome.chatResponse
      if (answer) {
        const source = outcome.snapshot?.run?.result ? "run_result" : "chat"
        diagnosticTrace({
          type: "answer_observed",
          attempt: outcome.attempt,
          answerSource: source,
          answerChars: answer.length
        })
        await test.info().attach(`answer-${source}`, {
          body: answer,
          contentType: "text/plain"
        })
      }
      const record = attempts.at(-1)
      if (record)
        diagnosticTrace({
          type: "task_result",
          attempt: record.attempt,
          executionPath: record.executionPath,
          status: record.terminalStatus,
          expectedStatus: record.expectedStatus,
          pauseReason: record.pauseReason,
          errorCode: record.errorCode,
          steps: record.steps,
          observations: record.observations,
          modelCalls: record.modelCalls,
          approvalsAsked: record.approvalsAsked,
          approvalsGranted: record.approvalsGranted,
          repeatedTargets: record.repeatedTargets,
          ambiguousTargets: record.ambiguousTargets,
          succeeded: record.succeeded,
          falseCompletion: record.falseCompletion,
          firstLimitation: record.firstLimitation
        })
      onRecorded?.(outcome)
    }
  })
}

// ── shared page and decision helpers ────────────────────────────────────────

export const named = (
  observation: AgentFixtureObservation,
  name: string
): AgentFixtureElement | undefined =>
  agentFixtureElement(observation, (element) => element.name === name)

export const page = (body: string, title = "Benchmark"): string =>
  `<!doctype html><title>${title}</title><main>${body}</main>`

/** A control whose activation is observable: it rewrites the page. */
export const observableButton = (label = "Continue"): string =>
  `<button type="button" onclick="document.querySelector('main').insertAdjacentHTML('beforeend','<p>Status: Active</p>');this.disabled=true">${label}</button>`

/**
 * Markdown and letter case are presentation, not content: a chat reply that
 * says "**Status:** Active" states the same fact as "Status: Active".
 */
const normalizedAnswer = (text: string): string =>
  text
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase()

const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const phrasePattern = (value: string): string =>
  value.split(" ").map(escapeRegex).join("\\s+")

const DENIAL_PATTERN =
  /\b(?:not(?!\s+only)|never|no|cannot|can['’]t|couldn['’]t|could\s+not|didn['’]t|did\s+not|doesn['’]t|does\s+not|isn['’]t|is\s+not|aren['’]t|are\s+not|wasn['’]t|was\s+not|weren['’]t|were\s+not|unable\s+to|failed\s+to)\b/i

const affirmativeOccurrence = (
  text: string,
  start: number,
  end: number
): boolean => {
  const prefix = text.slice(Math.max(0, start - 64), start)
  const claim = text.slice(start, end)
  if (DENIAL_PATTERN.test(`${prefix} ${claim}`)) return false
  const suffix = text.slice(end, end + 40)
  return !/^\s+(?:(?:is|are|was|were)\s+)?(?:not|incorrect|false|untrue|unconfirmed|unverified)\b/i.test(
    suffix
  )
}

const affirmedMatch = (text: string, pattern: RegExp): boolean => {
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0
    if (affirmativeOccurrence(text, start, start + match[0].length)) return true
  }
  return false
}

/**
 * Whether an answer carries a fact.
 *
 * The literal fact, or its value as a whole word when the answer also names
 * the fact's label. Requiring an affirmative assertion keeps "not Active"
 * and "could not confirm Status: Active" from passing on the value alone.
 */
export const answerCarriesFact = (
  answer: string | undefined,
  fact: string,
  value = fact.split(/:\s*/).at(-1) ?? fact
): boolean => {
  if (!answer) return false
  const said = normalizedAnswer(answer)
  const factText = normalizedAnswer(fact)
  const valueText = normalizedAnswer(value)
  const labelText = fact.includes(":")
    ? normalizedAnswer(fact.split(/:\s*/, 1)[0] ?? "")
    : factText.endsWith(` ${valueText}`) && factText !== valueText
      ? factText.slice(0, -(valueText.length + 1))
      : ""

  const factPattern = new RegExp(`\\b${phrasePattern(factText)}\\b`, "g")
  for (const sentence of said.split(/[.!?;\n]+/)) {
    if (affirmedMatch(sentence, factPattern)) return true
    if (!labelText || !valueText) continue
    const labeledValue = new RegExp(
      `\\b${phrasePattern(labelText)}\\b(?:\\W+\\w+){0,6}\\W+\\b${phrasePattern(valueText)}\\b`,
      "g"
    )
    if (affirmedMatch(sentence, labeledValue)) return true
  }
  return false
}

/**
 * A back-navigation task is only complete when its receipts show both the
 * Details visit and a confirmed Back command, and the tab has returned home.
 */
export const reportsBackNavigation = async (
  outcome: AgentScenarioOutcome
): Promise<boolean> => {
  const pageIsHome = new URL(outcome.page.url()).pathname === "/"
  if (!pageIsHome) return false

  const steps = outcome.snapshot?.steps
  if (!steps) {
    if (outcome.executionPath !== "planner_navigator") return false
    const history = outcome.navigationHistory ?? []
    const detailsIndex = history.lastIndexOf("/details")
    const returnedHome = history.slice(detailsIndex + 1).includes("/")
    if (detailsIndex < 0 || !returnedHome) return false
    return reportsFact("Home")(outcome)
  }

  const confirmed = (step: (typeof steps)[number]) =>
    step.status === "verified" && step.verification?.outcome === "confirmed"
  const detailsIndex = steps.findIndex(
    (step) =>
      step.command?.type === "click" &&
      step.target?.name?.toLowerCase() === "details" &&
      confirmed(step)
  )
  if (detailsIndex < 0) return false
  const returned = steps
    .slice(detailsIndex + 1)
    .some((step) => step.command?.type === "back" && confirmed(step))
  if (!returned) return false
  return reportsFact("Home")(outcome)
}

/**
 * A reading task's answer, checked against what the page actually says.
 *
 * `Boolean(run.result)` was circular: `result` is the model's own completion
 * summary, so an accepted completion produced one by construction and the
 * scorer agreed with the run every time — the false completion it exists to
 * catch could never be seen. Both halves are required here: the page has to
 * state the fact, so a fixture that drifted fails rather than passing
 * vacuously, and the answer has to carry it.
 */
export const reportsFact =
  (fact: string, value?: string) =>
  async (outcome: AgentScenarioOutcome): Promise<boolean> => {
    const rendered = await outcome.page.locator("body").innerText()
    const result = outcome.snapshot?.run?.result ?? outcome.chatResponse
    return rendered.includes(fact) && answerCarriesFact(result, fact, value)
  }

/**
 * The same, for a task whose answer is on a page the run opened. The tab it
 * reported from is not the tab the test drives, so every page in the context
 * is asked.
 */
export const reportsFactFromAnyTab =
  (fact: string, value?: string) =>
  async (outcome: AgentScenarioOutcome): Promise<boolean> => {
    const result = outcome.snapshot?.run?.result ?? outcome.chatResponse
    if (!answerCarriesFact(result, fact, value)) return false
    for (const open of outcome.page.context().pages()) {
      try {
        if ((await open.locator("body").innerText()).includes(fact)) return true
      } catch {
        /* A page that closed under us cannot show anything. */
      }
    }
    return false
  }

export const showsActiveStatus = async (
  outcome: AgentScenarioOutcome
): Promise<boolean> =>
  (await outcome.page.locator("main").innerText()).includes("Status: Active")

export const clickNamed = (
  observation: AgentFixtureObservation,
  name: string
): { type: string; ref?: string } => ({
  type: "click",
  ref: named(observation, name)?.ref
})

/** Click the named control, then finish citing the status the page gained. */
export const clickThenReport =
  (name = "Continue") =>
  (observation: AgentFixtureObservation): unknown =>
    observation.text.includes("Status: Active")
      ? { type: "complete", summary: "Active", evidence: "Status: Active" }
      : clickNamed(observation, name)

export const fieldPage = (fields: string[]): string =>
  page(
    `<div>${fields
      .map(
        (field) =>
          `<label for="${field}">${field}</label><input id="${field}" name="${field}">`
      )
      .join("")}<button type="button">Save</button></div>`
  )

export const fillFields =
  (fields: string[]) =>
  (observation: AgentFixtureObservation): unknown => {
    const next = fields
      .map((field) => named(observation, field))
      .find((element) => element && !element.value)
    return next
      ? { type: "clear_and_type", ref: next.ref, text: `value-${next.name}` }
      : {
          type: "complete",
          summary: "Filled.",
          evidence: `value-${fields.at(-1)}`
        }
  }

export const fieldsFilled =
  (fields: string[], scope = "") =>
  async (outcome: AgentScenarioOutcome): Promise<boolean> => {
    for (const field of fields) {
      const locator = scope
        ? outcome.page.frameLocator(scope).locator(`#${field}`)
        : outcome.page.locator(`#${field}`)
      if ((await locator.inputValue()) !== `value-${field}`) return false
    }
    return true
  }
