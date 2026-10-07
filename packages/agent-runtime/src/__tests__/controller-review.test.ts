import type {
  AgentCommand,
  AgentObservation,
  AgentRunState,
  AgentTaskRequirement
} from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"

import { MAX_AGENT_COMPLETION_REVIEWS } from "../completion-review"
import { createAgentController } from "../controller"
import type {
  AgentCompletionReviewPort,
  AgentCompletionReviewRequest,
  AgentControllerDependencies,
  AgentStepWrite
} from "../ports"
import { isLegalAgentTransition } from "../state"

/**
 * The reviewer is consulted only where the judge could not decide, and its
 * answer is never trusted further than the runtime can check it. These drive
 * the whole completion path to prove both halves: a supported claim settles
 * the run with a durable receipt of what the review cost, and every other
 * answer — no support, a contradiction, an error, a malformed reply, a spent
 * budget — leaves the run exactly where the judge left it.
 */

const saved: AgentTaskRequirement = {
  id: "r1",
  kind: "change",
  text: "Invoice 1 is saved"
}

const state = (overrides: Partial<AgentRunState> = {}): AgentRunState => ({
  version: 1,
  id: "run-1",
  goal: "Save invoice 1",
  status: "submitted",
  stepCount: 0,
  observationCount: 0,
  controlledTabId: 7,
  providerId: "ollama",
  modelId: "model",
  allowedOrigins: ["https://example.com"],
  requirements: [saved],
  createdAt: 1,
  updatedAt: 1,
  ...overrides
})

const observation = (generation: number): AgentObservation => ({
  snapshotId: `snapshot-${generation}`,
  generation,
  tabId: 7,
  frameId: 0,
  documentId: "document-1",
  url: "https://example.com/invoice/1",
  origin: "https://example.com",
  title: "Invoice 1",
  frames: [
    {
      frameId: 0,
      documentId: "document-1",
      origin: "https://example.com",
      url: "https://example.com/invoice/1",
      access: "ok",
      snapshotId: `snapshot-${generation}`,
      generation
    }
  ],
  elements: [],
  visibleText: "Invoice 1 Help menu expanded",
  scroll: {
    x: 0,
    y: 0,
    viewportWidth: 800,
    viewportHeight: 600,
    documentWidth: 800,
    documentHeight: 600
  },
  dialogs: [],
  capturedAt: 1
})

/** Provenance without proof: the quote is on the page and says nothing about saving. */
const complete = {
  type: "complete",
  summary: "Saved",
  outcomes: [{ id: "r1", met: true, evidence: "Help menu expanded" }]
}

const harness = (options: {
  review?: AgentCompletionReviewPort["review"]
  decisions?: unknown[]
  initial?: Partial<AgentRunState>
  /** Receipts a previous worker wrote before this controller existed. */
  written?: AgentStepWrite[]
  /** Commands click "Continue", and the page reports a status once one ran. */
  clicks?: true
}) => {
  let current = state(options.initial)
  const written: AgentStepWrite[] = [...(options.written ?? [])]
  const trace: { phase: string; metadata?: Record<string, unknown> }[] = []
  const requests: AgentCompletionReviewRequest[] = []
  const decisions = [...(options.decisions ?? [complete])]
  let generation = 0
  let executed = 0
  const dependencies: AgentControllerDependencies = {
    clock: { now: () => 10 },
    trace: (_run, phase, metadata) => trace.push({ phase, metadata }),
    persistence: {
      async load() {
        return current
      },
      async claim(input) {
        if (!input.expected.includes(current.status))
          return { claimed: false, state: current }
        current = { ...current, ...input.patch, status: input.phase }
        return { claimed: true, state: current }
      },
      async transition(input) {
        if (
          current.status !== input.from ||
          !isLegalAgentTransition(input.from, input.to)
        )
          return { transitioned: false, state: current }
        current = { ...current, ...input.patch, status: input.to }
        return { transitioned: true, state: current }
      },
      async appendStep(input) {
        written.push(input)
      },
      async steps(runId) {
        return written
          .filter((step) => step.runId === runId)
          .map((step, index) => ({ ...step, sequence: index + 1 }))
      }
    },
    model: {
      async decide() {
        return (decisions.shift() ?? complete) as never
      }
    },
    ...(options.review
      ? {
          review: {
            async review(runState, request, signal) {
              requests.push(request)
              return (options.review as AgentCompletionReviewPort["review"])(
                runState,
                request,
                signal
              )
            },
            reviewTelemetry: () => ({
              reviewPromptTokens: 120,
              reviewOutputTokens: 8
            })
          }
        }
      : {}),
    observation: {
      async observe() {
        generation += 1
        const page = observation(generation)
        return options.clicks && executed > 0
          ? { ...page, visibleText: `${page.visibleText} Status: Active` }
          : page
      }
    },
    effect: {
      async resolve(command: AgentCommand, page) {
        return {
          command,
          target: options.clicks
            ? {
                ref: "e1",
                tag: "button",
                role: "button",
                accessibleName: "Continue",
                sensitive: false,
                maySubmit: false
              }
            : { sensitive: false, maySubmit: false },
          semanticEffects: options.clicks ? ["activation"] : ["read"],
          snapshotIdentity: {
            snapshotId: page.snapshotId,
            generation: page.generation,
            tabId: page.tabId,
            frameId: page.frameId,
            documentId: page.documentId
          },
          sourceUrl: page.url,
          sourceOrigin: page.origin
        }
      },
      async execute() {
        executed += 1
        return { executedAt: 10 }
      },
      async verify() {
        return {
          outcome: "confirmed",
          evidence: { kind: "read", summary: "ok", observedAt: 10 }
        }
      }
    },
    policy: { evaluate: () => ({ type: "allow", risk: "low" }) },
    approval: { request: async () => ({ type: "approved" }) },
    takeover: { request: async () => ({ type: "takeover_started" }) }
  }
  return {
    controller: createAgentController(dependencies),
    written: () => written,
    trace,
    requests,
    executed: () => executed,
    state: () => current
  }
}

const supportFirstGrounded: AgentCompletionReviewPort["review"] = async (
  _state,
  request
) => ({
  verdicts: [
    {
      id: "r1",
      verdict: "supported",
      sources: request.evidenceLedger.slice(0, 1).map((record) => record.id)
    }
  ]
})

const completionRefusals = (written: readonly AgentStepWrite[]) =>
  written.filter((step) => step.stepId.includes(":completion:"))

describe("controller completion review", () => {
  it("shows the reviewer the action that was actually performed", async () => {
    const run = harness({
      clicks: true,
      review: async () => ({
        verdicts: [{ id: "r1", verdict: "insufficient_evidence", sources: [] }]
      }),
      decisions: [
        {
          type: "command",
          requirementId: "r1",
          command: {
            type: "click",
            ref: "e1",
            snapshotId: "snapshot-1",
            generation: 1
          }
        },
        {
          type: "complete",
          summary: "Clicked",
          outcomes: [{ id: "r1", met: true, evidence: "Status: Active" }]
        }
      ]
    })
    await run.controller.start("run-1")
    const request = run.requests[0]
    expect(request?.actions).toEqual([
      {
        requirementId: "r1",
        command: "click",
        role: "button",
        name: "Continue"
      }
    ])
    const marked = request?.evidenceLedger.filter((record) =>
      request.appearedAfterAction?.includes(record.id)
    )
    expect(marked?.map((record) => record.quote)).toEqual(["Status: Active"])
  })

  it("without a reviewer, a claim the judge cannot decide is refused as before", async () => {
    const run = harness({ decisions: [complete, complete] })
    await run.controller.start("run-1")
    expect(run.state()).toMatchObject({
      status: "paused",
      pauseReason: "question"
    })
    /** Two refusals, a recovery read, then the third refusal asks. */
    expect(completionRefusals(run.written())).toHaveLength(3)
  })

  it("settles a supported claim and records what the review cost", async () => {
    const run = harness({ review: supportFirstGrounded })
    await run.controller.start("run-1")

    expect(run.state()).toMatchObject({
      status: "completed",
      outcome: { met: ["r1"], unmet: [] }
    })
    expect(run.requests).toHaveLength(1)
    expect(run.requests[0]).toMatchObject({
      goal: "Save invoice 1",
      requirements: [saved],
      claims: [{ id: "r1", met: true, evidence: "Help menu expanded" }]
    })
    expect(
      run.requests[0].evidenceLedger.every(
        (record) =>
          record.kind === "observed_fact" || record.kind === "verified_effect"
      )
    ).toBe(true)
    const receipt = run
      .written()
      .find((step) => step.stepId === "run-1:review:1")
    expect(receipt).toMatchObject({
      status: "verified",
      verification: { outcome: "confirmed", evidence: { kind: "completion" } },
      telemetry: {
        reviews: 1,
        reviewPromptTokens: 120,
        reviewOutputTokens: 8,
        reviewDisagreements: 0
      }
    })
    expect(run.trace).toContainEqual({
      phase: "completion_reviewed",
      metadata: { asked: 1, disagreements: 0, outcome: "accepted" }
    })
  })

  it("keeps an unsupported claim refused, records the disagreement, and replays nothing", async () => {
    const run = harness({
      review: async () => ({
        verdicts: [{ id: "r1", verdict: "insufficient_evidence", sources: [] }]
      }),
      decisions: [complete, complete]
    })
    await run.controller.start("run-1")

    expect(run.state().status).toBe("paused")
    expect(run.executed()).toBe(0)
    const [first] = completionRefusals(run.written())
    expect(first).toMatchObject({
      status: "rejected",
      telemetry: { reviews: 1, reviewDisagreements: 1 }
    })
    expect(first.verification?.evidence.summary).toMatch(
      /do not repeat an action/i
    )
  })

  it("turns a reviewer's contradiction into a contradicted completion", async () => {
    const run = harness({
      review: async () => ({
        verdicts: [{ id: "r1", verdict: "contradicted", sources: [] }]
      }),
      decisions: [complete, complete]
    })
    await run.controller.start("run-1")
    expect(run.trace).toContainEqual(
      expect.objectContaining({
        phase: "completion_refused",
        metadata: expect.objectContaining({ reason: "contradicted_state" })
      })
    )
    expect(run.state().status).not.toBe("completed")
  })

  it("treats a failed review as no review, never as a pass", async () => {
    const run = harness({
      review: async () => {
        throw new Error("provider unavailable")
      },
      decisions: [complete, complete]
    })
    await run.controller.start("run-1")
    expect(run.state().status).toBe("paused")
    expect(run.trace.map((entry) => entry.phase)).toContain(
      "completion_review_failed"
    )
    expect(completionRefusals(run.written())[0]).toMatchObject({
      telemetry: { reviews: 1 }
    })
  })

  it("rejects a reviewer answer outside the verdict schema", async () => {
    const run = harness({
      review: async () =>
        ({
          verdicts: [{ id: "r1", verdict: "supported", sources: [] }],
          grant: "run_origin",
          requirements: []
        }) as never,
      decisions: [complete, complete]
    })
    await run.controller.start("run-1")
    expect(run.state().status).toBe("paused")
    expect(run.trace.map((entry) => entry.phase)).toContain(
      "completion_review_malformed"
    )
  })

  it("never asks a reviewer about a deterministic failure", async () => {
    const run = harness({
      review: supportFirstGrounded,
      initial: {
        requirements: [
          {
            ...saved,
            text: "Open the settings page",
            check: { type: "url", url: "https://example.com/settings" }
          }
        ]
      },
      decisions: [complete, complete]
    })
    await run.controller.start("run-1")
    expect(run.requests).toHaveLength(0)
    expect(run.state().status).not.toBe("completed")
  })

  it("counts reviews a previous worker already paid for", async () => {
    const run = harness({
      review: supportFirstGrounded,
      written: [
        {
          runId: "run-1",
          stepId: "run-1:completion:4",
          status: "rejected",
          at: 1,
          telemetry: { reviews: 2 }
        },
        {
          runId: "run-1",
          stepId: "run-1:completion:6",
          status: "rejected",
          at: 2,
          telemetry: { reviews: MAX_AGENT_COMPLETION_REVIEWS - 2 }
        }
      ],
      decisions: [complete, complete]
    })
    await run.controller.start("run-1")
    expect(run.requests).toHaveLength(0)
    expect(run.trace.map((entry) => entry.phase)).toContain(
      "completion_review_budget_exhausted"
    )
    expect(run.state().status).not.toBe("completed")
  })

  it("stops paying for reviews once the run's budget is spent", async () => {
    let answer = 0
    const run = harness({
      /** Alternating reasons keeps the refusal counter from pausing the run. */
      review: async () => {
        answer += 1
        return {
          verdicts: [
            {
              id: "r1",
              verdict:
                answer % 2 === 1 ? "contradicted" : "insufficient_evidence",
              sources: []
            }
          ]
        }
      },
      decisions: Array.from(
        { length: MAX_AGENT_COMPLETION_REVIEWS + 2 },
        () => complete
      )
    })
    await run.controller.start("run-1")
    expect(run.requests).toHaveLength(MAX_AGENT_COMPLETION_REVIEWS)
    expect(run.trace.map((entry) => entry.phase)).toContain(
      "completion_review_budget_exhausted"
    )
    expect(run.state().status).not.toBe("completed")
  })
})
