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
import type { AgentVisionPolicy } from "../vision"

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
  observations?: AgentObservation[]
  visionPolicy?: AgentVisionPolicy
  screenshotsPermitted?: boolean
  requirements?: AgentRunState["requirements"]
}) => {
  let current = state(
    options.requirements ? { requirements: options.requirements } : {}
  )
  const written: AgentStepWrite[] = []
  const decideInputs: AgentModelInput[] = []
  const resolveContexts: (AgentResolutionContext | undefined)[] = []
  const trace: string[] = []
  const observations = options.observations ?? [
    observation(1),
    observation(2),
    observation(3)
  ]
  const approvals: unknown[] = []
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
      ...(options.visionPolicy === undefined
        ? {}
        : { visionPolicy: async () => options.visionPolicy ?? "always" }),
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
    ...(options.screenshotsPermitted === undefined
      ? {}
      : {
          screenshotsPermitted: async () =>
            options.screenshotsPermitted === true
        }),
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
    approval: {
      request: async (request) => {
        approvals.push(request)
        return { type: "approved" }
      }
    },
    takeover: { request: async () => ({ type: "takeover_started" }) }
  }
  return {
    controller: createAgentController(dependencies),
    decideInputs,
    resolveContexts,
    approvals,
    written,
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

  describe("asking to look", () => {
    /**
     * A canvas application on one URL: plenty of controls, so the auto rules
     * skip the picture after the first step, and the state that matters is
     * drawn rather than listed.
     */
    const busy = (generation: number): AgentObservation => ({
      ...observation(generation),
      elements: Array.from({ length: 8 }, (_value, index) => ({
        ref: `e${index + 1}`,
        frameId: 0,
        tag: "button",
        visible: true,
        enabled: true,
        editable: false,
        sensitive: false
      })) as unknown as AgentObservation["elements"]
    })
    const onDocument = (
      current: AgentObservation,
      documentId: string
    ): AgentObservation => ({
      ...current,
      documentId,
      frames: current.frames.map((frame) => ({ ...frame, documentId }))
    })
    const read = (generation: number) => ({
      type: "command",
      command: {
        type: "read",
        snapshotId: `snapshot-${generation}`,
        generation
      }
    })
    const look = (generation: number) => ({
      type: "command",
      command: {
        type: "look",
        snapshotId: `snapshot-${generation}`,
        generation
      }
    })

    it("pictures an unchanged canvas page after the first step when the model asks", async () => {
      const captured: string[] = []
      const run = harness({
        vision: true,
        visionPolicy: "auto",
        observations: [busy(1), busy(2), busy(3), busy(4)],
        capture: async (request) => {
          captured.push(request.observation.snapshotId)
          return screenshotFor(request.observation)
        },
        decisions: [
          read(1),
          look(2),
          read(3),
          { type: "complete", summary: "Done" }
        ]
      })
      await run.controller.start("run-1")

      /** Step 2 had no picture and was still offered one. */
      expect(run.decideInputs[1]?.screenshot).toBeUndefined()
      expect(run.decideInputs[1]?.visual).toEqual({ available: true })
      /** The look buys the next step a picture of the same, unchanged URL. */
      expect(run.decideInputs[2]?.screenshot?.snapshotId).toBe("snapshot-3")
      expect(captured).toEqual(["snapshot-1", "snapshot-3"])
      /** A step without a picture grounds nothing in one. */
      expect(run.resolveContexts[1]?.screenshot).toBeUndefined()
      expect(run.resolveContexts[2]?.screenshot?.snapshotId).toBe("snapshot-3")
    })

    it("reads only: no approval, no navigation, and no picture in the durable record", async () => {
      const run = harness({
        vision: true,
        visionPolicy: "auto",
        observations: [busy(1), busy(2), busy(3)],
        decisions: [look(1), { type: "complete", summary: "Done" }]
      })
      await run.controller.start("run-1")
      expect(run.state().status).toBe("completed")
      expect(run.approvals).toEqual([])
      expect(run.state().allowedOrigins).toEqual(["https://example.com"])
      expect(run.written.some((step) => step.command?.type === "look")).toBe(
        true
      )
      /** The picture is the decision's companion, never the receipt's. */
      expect(JSON.stringify(run.written)).not.toContain("AAAA")
      expect(JSON.stringify(run.written)).not.toContain("image/jpeg")
    })

    it("tells the model the true reason pictures are unavailable", async () => {
      const textOnly = harness({ vision: false })
      await textOnly.controller.start("run-1")
      expect(textOnly.decideInputs[0]?.visual).toEqual({
        available: false,
        reason: "model_text_only"
      })

      const noPort = harness({ vision: true, screenshotPort: false })
      await noPort.controller.start("run-1")
      expect(noPort.decideInputs[0]?.visual).toMatchObject({
        reason: "no_capture_path"
      })

      const capture = vi.fn(async () => undefined)
      const unacknowledged = harness({
        vision: true,
        capture,
        screenshotsPermitted: false
      })
      await unacknowledged.controller.start("run-1")
      expect(unacknowledged.decideInputs[0]?.visual).toMatchObject({
        reason: "not_permitted"
      })
      expect(capture).not.toHaveBeenCalled()

      const off = harness({ vision: true, capture, visionPolicy: "never" })
      await off.controller.start("run-1")
      expect(off.decideInputs[0]?.visual).toMatchObject({
        reason: "disabled_by_user"
      })
      expect(capture).not.toHaveBeenCalled()

      const held = harness({
        vision: true,
        capture,
        observations: [
          {
            ...observation(1),
            dialogs: [
              {
                id: "held",
                type: "alert",
                message: "Hi",
                origin: "https://example.com"
              }
            ]
          } as AgentObservation
        ],
        decisions: [{ type: "ask_user", question: "Dismiss?" }]
      })
      await held.controller.start("run-1")
      expect(held.decideInputs[0]?.visual).toMatchObject({
        reason: "dialog_open"
      })
      expect(capture).not.toHaveBeenCalled()
    })

    it("withdraws look on a document whose requested picture came back empty", async () => {
      let attempts = 0
      const run = harness({
        vision: true,
        visionPolicy: "auto",
        observations: [busy(1), busy(2), busy(3), busy(4)],
        capture: async (request) => {
          attempts += 1
          /** Every picture after the first is refused, as masking would. */
          return attempts === 1 ? screenshotFor(request.observation) : undefined
        },
        decisions: [
          look(1),
          read(2),
          read(3),
          { type: "complete", summary: "Done" }
        ]
      })
      await run.controller.start("run-1")
      expect(run.decideInputs[1]?.screenshot).toBeUndefined()
      expect(run.decideInputs[1]?.visual).toEqual({
        available: false,
        reason: "capture_failed"
      })
      /** Withdrawn for the document, not for one step. */
      expect(run.decideInputs[2]?.visual).toEqual({
        available: false,
        reason: "capture_failed"
      })
      expect(run.state().status).toBe("completed")
    })

    it("offers look again on a new document", async () => {
      let attempts = 0
      const run = harness({
        vision: true,
        visionPolicy: "auto",
        observations: [
          busy(1),
          busy(2),
          onDocument(busy(3), "document-2"),
          onDocument(busy(4), "document-2")
        ],
        capture: async (request) => {
          attempts += 1
          return attempts === 1 ? screenshotFor(request.observation) : undefined
        },
        decisions: [look(1), read(2), { type: "complete", summary: "Done" }]
      })
      await run.controller.start("run-1")
      expect(run.decideInputs[1]?.visual).toMatchObject({
        reason: "capture_failed"
      })
      expect(run.decideInputs[2]?.visual).toEqual({ available: true })
    })
  })

  it("completes a read seen only in the picture, reported as seen, with no image kept", async () => {
    const run = harness({
      vision: true,
      requirements: [
        { id: "r1", text: "Report the canvas code", kind: "read" }
      ],
      decisions: [
        {
          type: "complete",
          summary: "The canvas shows KV-305.",
          outcomes: [{ id: "r1", met: true, evidence: "KV-305" }]
        }
      ]
    })
    await run.controller.start("run-1")
    expect(run.state().status).toBe("completed")
    expect(run.state().outcome).toEqual({
      met: ["r1"],
      unmet: [],
      visual: ["r1"]
    })
    const durable = JSON.stringify([run.written, run.state()])
    expect(durable).toContain("visual_observation")
    expect(durable).not.toContain("AAAA")
    expect(durable).not.toContain("image/jpeg")
  })

  it("does not complete that read without the picture", async () => {
    const run = harness({
      vision: false,
      requirements: [
        { id: "r1", text: "Report the canvas code", kind: "read" }
      ],
      decisions: [
        {
          type: "complete",
          summary: "The canvas shows KV-305.",
          outcomes: [{ id: "r1", met: true, evidence: "KV-305" }]
        },
        { type: "ask_user", question: "Stuck" }
      ]
    })
    await run.controller.start("run-1")
    expect(run.state().status).not.toBe("completed")
  })
})
