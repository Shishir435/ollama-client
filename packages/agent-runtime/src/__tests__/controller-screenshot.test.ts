import type {
  AgentCommand,
  AgentObservation,
  AgentRunState,
  AgentScreenshot
} from "@ollama-client/contracts"
import { describe, expect, it, vi } from "vitest"

import { createAgentController } from "../controller"
import type {
  AgentControllerDependencies,
  AgentModelInput,
  AgentResolutionContext,
  AgentStepWrite
} from "../ports"
import { isLegalAgentTransition } from "../state"

/**
 * The picture rides beside the observation: taken only for a model that can
 * see, bound to the same snapshot, handed to the decision and to the
 * resolution of the command it produced, and never allowed to fail the run.
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
  const dependencies: AgentControllerDependencies = {
    clock: { now: () => 10 },
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
      }
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
    decideInputs,
    resolveContexts,
    trace,
    state: () => current
  }
}

describe("controller screenshots", () => {
  it("pictures the page for a vision model and hands the picture to the decision and the resolution", async () => {
    const capture = vi.fn(async (request: { observation: AgentObservation }) =>
      screenshotFor(request.observation)
    )
    const run = harness({ vision: true, capture })
    await run.controller.start("run-1")
    expect(run.state().status).toBe("completed")
    expect(capture).toHaveBeenCalledTimes(2)
    expect(run.decideInputs[0]?.screenshot?.snapshotId).toBe("snapshot-1")
    expect(run.resolveContexts[0]?.screenshot?.snapshotId).toBe("snapshot-1")
    expect(run.trace).toContain("screenshot")
  })

  it("takes no picture for a text-only model, or without a capture port", async () => {
    const capture = vi.fn(async () => undefined)
    const textOnly = harness({ vision: false, capture })
    await textOnly.controller.start("run-1")
    expect(capture).not.toHaveBeenCalled()
    expect(textOnly.decideInputs[0]?.screenshot).toBeUndefined()

    const noPort = harness({ vision: true, screenshotPort: false })
    await noPort.controller.start("run-1")
    expect(noPort.decideInputs[0]?.screenshot).toBeUndefined()

    const noVision = harness({ capture })
    await noVision.controller.start("run-1")
    expect(capture).not.toHaveBeenCalled()
  })

  it("decides from the DOM alone when the capture fails or comes back unbound", async () => {
    const failing = harness({
      vision: true,
      capture: async () => {
        throw new Error("no debugger")
      }
    })
    await failing.controller.start("run-1")
    expect(failing.state().status).toBe("completed")
    expect(failing.decideInputs[0]?.screenshot).toBeUndefined()
    expect(failing.trace).toContain("screenshot_failed")

    const unbound = harness({
      vision: true,
      capture: async (request) =>
        screenshotFor(request.observation, {
          generation: 99,
          snapshotId: "old"
        })
    })
    await unbound.controller.start("run-1")
    expect(unbound.decideInputs[0]?.screenshot).toBeUndefined()
    expect(unbound.resolveContexts[0]?.screenshot).toBeUndefined()
    expect(unbound.trace).toContain("screenshot_unbound")
  })

  it("passes the previous step's zoom to the next capture", async () => {
    const zooms: unknown[] = []
    const run = harness({
      vision: true,
      capture: async (request) => {
        zooms.push(request.zoom)
        return screenshotFor(request.observation)
      },
      decisions: [
        {
          type: "command",
          command: {
            type: "zoom",
            snapshotId: "snapshot-1",
            generation: 1,
            x: 10,
            y: 20,
            width: 100,
            height: 50
          }
        },
        { type: "complete", summary: "Done" }
      ]
    })
    await run.controller.start("run-1")
    expect(zooms).toEqual([undefined, { x: 10, y: 20, width: 100, height: 50 }])
  })
})
