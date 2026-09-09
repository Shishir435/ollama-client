import type { AgentFixtureObservation } from "../../fixtures/agent-scenario"
import {
  agentConfirmingButton,
  agentFixtureElement,
  runAgentScenario
} from "../../fixtures/agent-scenario"
import { expect } from "../../fixtures/extension"
import type { AgentAttemptRecord } from "../agent-benchmark"
import {
  approvalsAsked,
  countDuplicateEffects,
  writeAgentBenchmarkReport
} from "../agent-benchmark"

/**
 * The frozen benchmark: one attempt per task family, recorded rather than
 * asserted.
 *
 * Deliberately not tagged `@critical`. A gate says pass or fail; this says
 * what happened, in counts a later pass can be compared against, and the
 * thresholds in the plan's section 01 are meant to be assigned from a clean
 * pass rather than guessed before one exists. It is also why nothing here
 * publishes a rate: a handful of attempts cannot support one.
 */

const attempts: AgentAttemptRecord[] = []
const backend = process.env.AGENT_BENCHMARK_BACKEND ?? "fixture"

const record = (
  family: string,
  scenario: string,
  startedAt: number,
  outcome: Parameters<Parameters<typeof runAgentScenario>[0]["verify"]>[0]
): void => {
  const run = outcome.snapshot?.run
  const steps = outcome.snapshot?.steps ?? []
  const asked = approvalsAsked(outcome.messages)
  attempts.push({
    family,
    scenario,
    attempt: 1,
    backend,
    terminalStatus: run?.status ?? "unknown",
    ...(run?.pauseReason ? { pauseReason: run.pauseReason } : {}),
    ...(run?.error?.code ? { errorCode: run.error.code } : {}),
    steps: new Set(steps.map((step) => step.stepId)).size,
    observations: run?.observationCount ?? 0,
    modelCalls: outcome.wire.length,
    approvalsAsked: asked.length,
    approvalsGranted: run?.grants?.length ?? 0,
    duplicateEffects: countDuplicateEffects(steps),
    wallMs: Date.now() - startedAt,
    ...(run?.error?.code
      ? { firstLimitation: run.error.code }
      : run?.pauseReason
        ? { firstLimitation: run.pauseReason }
        : {})
  })
}

const clickContinue = (observation: AgentFixtureObservation) =>
  observation.text.includes("Status: Active")
    ? { type: "complete", summary: "Active" }
    : {
        type: "click",
        ref: agentFixtureElement(
          observation,
          (element) => element.name === "Continue"
        )?.ref
      }

let startedAt = Date.now()

runAgentScenario({
  name: "benchmark read-and-extract",
  gated: false,
  goal: "Report the status shown on the page.",
  status: "completed",
  html: () =>
    "<!doctype html><title>Benchmark read</title><main><h1>Account</h1><p>Status: Active</p></main>",
  decide: () => ({ type: "complete", summary: "Active" }),
  verify: (outcome) => {
    record("read-and-extract", "benchmark read-and-extract", startedAt, outcome)
    startedAt = Date.now()
    expect(outcome.snapshot?.run?.status).toBe("completed")
  }
})

runAgentScenario({
  name: "benchmark single-action",
  gated: false,
  goal: "Click Continue and report the status.",
  status: "completed",
  html: () =>
    `<!doctype html><title>Benchmark click</title><main>${agentConfirmingButton()}</main>`,
  decide: clickContinue,
  verify: (outcome) => {
    record("single-action", "benchmark single-action", startedAt, outcome)
    startedAt = Date.now()
    // One click, never two: the whole series exists to keep this true.
    expect(countDuplicateEffects(outcome.snapshot?.steps ?? [])).toBe(0)
  }
})

runAgentScenario({
  name: "benchmark form-preparation",
  gated: false,
  goal: "Fill in the name field. Do not submit.",
  status: "completed",
  approvalScope: "run_origin",
  html: () =>
    '<!doctype html><title>Benchmark form</title><main><div><label for="given">given</label><input id="given" name="given"></div></main>',
  decide(observation: AgentFixtureObservation) {
    const field = agentFixtureElement(
      observation,
      (element) => element.name === "given"
    )
    return field && !field.value
      ? { type: "clear_and_type", ref: field.ref, text: "Alice" }
      : { type: "complete", summary: "Filled." }
  },
  verify: (outcome) => {
    record("form-preparation", "benchmark form-preparation", startedAt, outcome)
    startedAt = Date.now()
    const path = writeAgentBenchmarkReport(attempts, backend)
    // Written last, so one pass produces one report naming every family.
    expect(attempts).toHaveLength(3)
    expect(path).toContain("agent-benchmark-")
  }
})
