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
import type { AgentAttemptRecord } from "./agent-benchmark"
import {
  approvalsAsked,
  countRepeatedTargets,
  recordAttempt
} from "./agent-benchmark"

/**
 * How a frozen evaluation task is declared and recorded.
 *
 * Separated from the tasks themselves so the two can be read for what they
 * are: this file is the instrument, and the suite beside it is the thing being
 * measured. A task states its goal, the page it runs against, the decisions a
 * scripted model makes, and — the part a gate does not have — a predicate that
 * reads the page to say whether the goal was actually met.
 */

export const benchmarkAttempts = Math.max(
  1,
  Number.parseInt(process.env.AGENT_BENCHMARK_ATTEMPTS ?? "1", 10) || 1
)

export const benchmarkModel = process.env.AGENT_HOSTED_MODEL ?? "fixture-agent"

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
    }
  }
  recordAttempt(input.attempts, {
    family: input.family,
    scenario: input.scenario,
    attempt: outcome.attempt,
    backend: outcome.backend,
    terminalStatus: run?.status ?? "unknown",
    expectedStatus: input.expectedStatus,
    ...(run?.pauseReason ? { pauseReason: run.pauseReason } : {}),
    ...(run?.error?.code ? { errorCode: run.error.code } : {}),
    steps: new Set(steps.map((step) => step.stepId)).size,
    observations: run?.observationCount ?? 0,
    modelCalls: outcome.wire.length,
    approvalsAsked: approvalsAsked(outcome.messages).length,
    approvalsGranted: run?.grants?.length ?? 0,
    repeatedTargets: targets.repeated,
    ambiguousTargets: targets.ambiguous,
    wallMs: Date.now() - input.outcome.startedAt,
    ...(met === undefined ? {} : { succeeded: met }),
    ...(met === undefined
      ? {}
      : { falseCompletion: run?.status === "completed" && !met }),
    ...(outcome.tokens
      ? {
          promptTokens: outcome.tokens.prompt,
          completionTokens: outcome.tokens.completion
        }
      : {}),
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
  runAgentScenario({
    ...rest,
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
        ...(succeeded ? { succeeded } : {})
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
