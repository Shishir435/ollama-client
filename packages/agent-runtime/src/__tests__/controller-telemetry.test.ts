import type {
  AgentCommand,
  AgentObservation,
  AgentRunState,
  AgentScreenshot,
  AgentStepTelemetry
} from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"

import { createAgentController } from "../controller"
import type {
  AgentControllerDependencies,
  AgentModelInput,
  AgentResolutionContext,
  AgentStepWrite
} from "../ports"
import { isLegalAgentTransition } from "../state"

/**
 * What a step cost is measured in pieces by whoever can see each one — the
 * observation port times its own read, the model port reports the provider's
 * usage, the executor times the effect — and the pieces arrive at different
 * moments, some of them after the step's first receipt is already written.
 *
 * So the accumulator has to hold a measurement until a receipt claims it, and
 * hand it to the right step when it does. These cover both halves: that every
 * phase reaches the step it belongs to, and that none of it reaches the next.
 */

const state = (overrides: Partial<AgentRunState> = {}): AgentRunState => ({
  version: 1,
  id: "run-1",
  goal: "Click the red square",
  status: "submitted",
  stepCount: 0,
  observationCount: 0,
  controlledTabId: 7,
  providerId: "ollama",
  modelId: "vision-model",
  allowedOrigins: ["https://example.com"],
  createdAt: 1,
  updatedAt: 1,
  ...overrides
})

const observation = (generation = 1): AgentObservation => ({
  snapshotId: `snapshot-${generation}`,
  generation,
  tabId: 7,
  frameId: 0,
  documentId: "document-1",
  url: "https://example.com/",
  origin: "https://example.com",
  title: "Example",
  frames: [
    {
      frameId: 0,
      documentId: "document-1",
      origin: "https://example.com",
      url: "https://example.com/",
      access: "ok",
      snapshotId: `snapshot-${generation}`,
      generation
    }
  ],
  elements: [],
  visibleText: "",
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

const screenshotFor = (
  current: AgentObservation,
  overrides: Partial<AgentScreenshot> = {}
): AgentScreenshot => ({
  snapshotId: current.snapshotId,
  generation: current.generation,
  tabId: current.tabId,
  frameId: current.frameId,
  documentId: current.documentId,
  capturedAt: 2,
  mimeType: "image/jpeg",
  data: "AAAA",
  imageWidth: 800,
  imageHeight: 600,
  region: { x: 0, y: 0, width: 800, height: 600 },
  scale: 1,
  scroll: { x: 0, y: 0 },
  maskedRegions: 0,
  ...overrides
})

const harness = (options: {
  vision?: boolean | (() => Promise<boolean>)
  capture?: AgentControllerDependencies["screenshot"] extends infer S
    ? S extends { capture: infer C }
      ? C
      : never
    : never
  screenshotPort?: boolean
  decisions?: unknown[]
  /** Advances one millisecond per read, so every phase measures non-zero. */
  tickingClock?: boolean
  decisionTelemetry?: () => AgentStepTelemetry | undefined
}) => {
  let current = state()
  const written: AgentStepWrite[] = []
  const decideInputs: AgentModelInput[] = []
  const resolveContexts: (AgentResolutionContext | undefined)[] = []
  const trace: string[] = []
  const observations = [observation(1), observation(2), observation(3)]
  const decisions = [
    ...(options.decisions ?? [
      {
        type: "command",
        command: { type: "read", snapshotId: "snapshot-1", generation: 1 }
      },
      { type: "complete", summary: "Done" }
    ])
  ]
  let tick = 10
  /** Advances on every read so each phase measures a non-zero duration. */
  const now = (): number => {
    if (!options.tickingClock) return 10
    tick += 1
    return tick
  }
  const dependencies: AgentControllerDependencies = {
    clock: { now },
    trace: (_run, phase) => trace.push(phase),
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
        ) {
          return { transitioned: false, state: current }
        }
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
      ...(options.vision === undefined
        ? {}
        : {
            vision:
              typeof options.vision === "function"
                ? options.vision
                : async () => options.vision as boolean
          }),
      async decide(input) {
        decideInputs.push(input)
        return decisions.shift() as never
      },
      ...(options.decisionTelemetry
        ? { decisionTelemetry: options.decisionTelemetry }
        : {})
    },
    observation: {
      async observe() {
        const next = observations.shift()
        if (!next) throw new Error("No observation")
        return next
      }
    },
    ...(options.screenshotPort === false
      ? {}
      : {
          screenshot: {
            capture:
              options.capture ??
              (async (request) => screenshotFor(request.observation))
          }
        }),
    effect: {
      async resolve(command: AgentCommand, current, context) {
        resolveContexts.push(context)
        return {
          command,
          target: { sensitive: false, maySubmit: false },
          semanticEffects: ["read"],
          snapshotIdentity: {
            snapshotId: current.snapshotId,
            generation: current.generation,
            tabId: current.tabId,
            frameId: current.frameId,
            documentId: current.documentId
          },
          sourceUrl: current.url,
          sourceOrigin: current.origin
        }
      },
      async execute() {
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
    decideInputs,
    resolveContexts,
    trace,
    state: () => current
  }
}

describe("controller step telemetry", () => {
  /**
   * The phases of a step are measured by whoever can see each one and arrive
   * at different moments. Every receipt carries the running total, because
   * the panel, the history and the completion judge all collapse a step's
   * receipts to the latest one.
   */
  it("carries each phase onto the step it belongs to", async () => {
    const run = harness({ tickingClock: true })
    await run.controller.start("run-1")

    const receipts = run.written().filter((s) => s.stepId === "run-1:1")
    expect(receipts.length).toBeGreaterThan(1)
    const last = receipts[receipts.length - 1]
    expect(last.telemetry).toBeDefined()
    expect(last.telemetry?.observeMs).toBeGreaterThan(0)
    expect(last.telemetry?.resolveMs).toBeGreaterThan(0)
    expect(last.telemetry?.executeMs).toBeGreaterThan(0)
    expect(last.telemetry?.verifyMs).toBeGreaterThan(0)
    expect(last.telemetry?.observations).toBeGreaterThanOrEqual(1)
  })

  /**
   * The provider's usage is the only part of a step the controller cannot
   * time itself, so it is read from the port rather than measured.
   */
  it("claims the decision port's reported usage", async () => {
    const run = harness({
      tickingClock: true,
      decisionTelemetry: () => ({ promptTokens: 7_412, outputTokens: 118 })
    })
    await run.controller.start("run-1")

    const last = run
      .written()
      .filter((s) => s.stepId === "run-1:1")
      .pop()
    expect(last?.telemetry).toMatchObject({
      promptTokens: 7_412,
      outputTokens: 118
    })
  })

  /**
   * A second step must not inherit the first step's execute and verify
   * timings, which are measured after the first step's own receipts are
   * already written.
   */
  it("does not spill one step's cost onto the next", async () => {
    const read = (generation: number) => ({
      type: "command" as const,
      command: {
        type: "read" as const,
        snapshotId: `snapshot-${generation}`,
        generation
      }
    })
    const run = harness({
      tickingClock: true,
      decisions: [read(1), read(2), { type: "complete", summary: "Done" }]
    })
    await run.controller.start("run-1")

    const first = run
      .written()
      .filter((s) => s.stepId === "run-1:1")
      .pop()
    const stepIds = [...new Set(run.written().map((s) => s.stepId))]
    expect(stepIds).toEqual(["run-1:1", "run-1:2"])

    const second = run
      .written()
      .filter((s) => s.stepId === "run-1:2")
      .pop()
    const firstExecute = first?.telemetry?.executeMs ?? 0
    expect(firstExecute).toBeGreaterThan(0)
    /**
     * The second step's own execute is its own. What it must not carry is the
     * first step's, which was measured after the first step's last receipt.
     */
    expect(second?.telemetry?.executeMs ?? 0).toBeLessThan(
      firstExecute + firstExecute
    )
    expect(second?.telemetry?.observations).toBe(1)
  })

  /** A port that measures nothing leaves the receipt unmeasured, not zeroed. */
  it("writes no telemetry when nothing measured any", async () => {
    const run = harness({})
    await run.controller.start("run-1")

    for (const step of run.written()) {
      expect(step.telemetry?.promptTokens).toBeUndefined()
    }
  })
})
