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
  countRepeatedTargets,
  recordAttempt,
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

/**
 * Derived from the one variable that actually changes how a scenario runs, so
 * a fixture pass cannot be labelled hosted. A report whose backend field is
 * whatever an operator typed is a report that cannot be compared.
 */
const backend = process.env.AGENT_HOSTED_MODEL
  ? `hosted:${process.env.AGENT_HOSTED_MODEL}`
  : "fixture"

const record = (
  family: string,
  scenario: string,
  startedAt: number,
  outcome: Parameters<Parameters<typeof runAgentScenario>[0]["verify"]>[0]
): void => {
  const run = outcome.snapshot?.run
  const steps = outcome.snapshot?.steps ?? []
  const asked = approvalsAsked(outcome.messages)
  const targets = countRepeatedTargets(steps)
  recordAttempt(attempts, {
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
    repeatedTargets: targets.repeated,
    ambiguousTargets: targets.ambiguous,
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
    expect(countRepeatedTargets(outcome.snapshot?.steps ?? []).repeated).toBe(0)
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
    // Checked before writing, so a retry that lost an earlier scenario
    // cannot produce a report that looks complete.
    expect(attempts).toHaveLength(3)
    expect(writeAgentBenchmarkReport(attempts, backend)).toContain(
      "agent-benchmark-"
    )
  }
})
