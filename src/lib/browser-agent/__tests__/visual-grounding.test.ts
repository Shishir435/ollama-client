import {
  AgentGroundingError,
  AgentStaleObservationError,
  evaluateAgentPolicy
} from "@ollama-client/agent-runtime"
import type {
  AgentElement,
  AgentObservation,
  AgentScreenshot
} from "@ollama-client/contracts"
import { AgentCommandSchema } from "@ollama-client/contracts"
import { describe, expect, it, vi } from "vitest"

import type { AgentHitTestResult } from "../control-port"
import {
  type AgentEffectResolverAdapter,
  resolveDomMutationAgentEffect,
  resolveReadOnlyAgentEffect
} from "../resolved-effect"

const observation = (
  overrides: Partial<AgentObservation> = {}
): AgentObservation => ({
  snapshotId: "snapshot-1",
  generation: 1,
  tabId: 7,
  frameId: 0,
  documentId: "document-1",
  url: "https://example.com/board",
  origin: "https://example.com",
  title: "Board",
  frames: [
    {
      frameId: 0,
      documentId: "document-1",
      origin: "https://example.com",
      url: "https://example.com/board",
      access: "ok",
      snapshotId: "snapshot-1",
      generation: 1
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
  capturedAt: 1,
  ...overrides
})

const screenshot = (
  overrides: Partial<AgentScreenshot> = {}
): AgentScreenshot => ({
  snapshotId: "snapshot-1",
  generation: 1,
  tabId: 7,
  frameId: 0,
  documentId: "document-1",
  capturedAt: 2,
  mimeType: "image/jpeg",
  data: "AAAA",
  imageWidth: 1600,
  imageHeight: 1200,
  region: { x: 0, y: 0, width: 800, height: 600 },
  scale: 2,
  scroll: { x: 0, y: 0 },
  maskedRegions: 0,
  ...overrides
})

const canvas: AgentElement = {
  ref: "e9",
  frameId: 0,
  tag: "canvas",
  visible: true,
  enabled: true,
  editable: false,
  sensitive: false
}

const adapter = (hit: AgentHitTestResult | "none" = { element: canvas }) => {
  const hitTest = vi.fn(
    async (): Promise<AgentHitTestResult> => (hit === "none" ? null : hit)
  )
  const instance: AgentEffectResolverAdapter = {
    getTab: async (tabId) => ({ id: tabId, url: observation().url }),
    classifyAccess: async () => "ok",
    resolveHistoryDestination: async () => undefined,
    ...(hit === "none" ? {} : { hitTest })
  }
  return { instance, hitTest }
}

const clickPoint = (x = 400, y = 300) =>
  AgentCommandSchema.parse({
    type: "click_point",
    x,
    y,
    snapshotId: "snapshot-1",
    generation: 1
  })

describe("visual grounding resolution", () => {
  it("turns a screenshot pixel into the control under it, keeping the CSS point", async () => {
    const { instance, hitTest } = adapter()
    const effect = await resolveDomMutationAgentEffect({
      command: clickPoint(400, 300),
      observation: observation(),
      adapter: instance,
      context: { screenshot: screenshot() }
    })
    expect(hitTest).toHaveBeenCalledWith(
      expect.objectContaining({ snapshotId: "snapshot-1", frameId: 0 }),
      { x: 200, y: 150 }
    )
    expect(effect.target).toMatchObject({
      ref: "e9",
      tag: "canvas",
      point: { x: 200, y: 150 }
    })
    expect(effect.semanticEffects).toEqual(["activation"])
    expect(
      evaluateAgentPolicy({
        runId: "run",
        stepId: "run:1",
        effect,
        allowedOrigins: ["https://example.com"],
        scopedTabIds: [7],
        now: 3
      }).type
    ).toBe("approval_required")
  })

  it("refuses a point with no screenshot, a stale screenshot, or a point outside the image", async () => {
    const { instance } = adapter()
    await expect(
      resolveDomMutationAgentEffect({
        command: clickPoint(),
        observation: observation(),
        adapter: instance
      })
    ).rejects.toBeInstanceOf(AgentGroundingError)
    await expect(
      resolveDomMutationAgentEffect({
        command: clickPoint(),
        observation: observation(),
        adapter: instance,
        context: {
          screenshot: screenshot({ generation: 0, snapshotId: "snapshot-0" })
        }
      })
    ).rejects.toBeInstanceOf(AgentStaleObservationError)
    /* The page scrolled between the picture and the observation: not the same view. */
    await expect(
      resolveDomMutationAgentEffect({
        command: clickPoint(),
        observation: observation(),
        adapter: instance,
        context: { screenshot: screenshot({ scroll: { x: 0, y: 200 } }) }
      })
    ).rejects.toBeInstanceOf(AgentStaleObservationError)
    await expect(
      resolveDomMutationAgentEffect({
        command: clickPoint(1700, 10),
        observation: observation(),
        adapter: instance,
        context: { screenshot: screenshot() }
      })
    ).rejects.toThrow(/outside the attached screenshot/)
  })

  it("refuses a point on nothing, on a frame, or on a page the host cannot ask", async () => {
    for (const [hit, pattern] of [
      [null, /nothing under it/],
      [{ frameElement: true }, /embedded frame/]
    ] as const) {
      await expect(
        resolveDomMutationAgentEffect({
          command: clickPoint(),
          observation: observation(),
          adapter: adapter(hit).instance,
          context: { screenshot: screenshot() }
        })
      ).rejects.toThrow(pattern)
    }
    await expect(
      resolveDomMutationAgentEffect({
        command: clickPoint(),
        observation: observation(),
        adapter: adapter("none").instance,
        context: { screenshot: screenshot() }
      })
    ).rejects.toThrow(/not available/)
  })

  it("keeps every click rule for the control it finds: sensitive input, links, checkboxes", async () => {
    const sensitive = await resolveDomMutationAgentEffect({
      command: clickPoint(),
      observation: observation(),
      adapter: adapter({
        element: {
          ...canvas,
          tag: "input",
          type: "password",
          editable: true,
          sensitive: true
        }
      }).instance,
      context: { screenshot: screenshot() }
    })
    expect(sensitive.semanticEffects).toContain("sensitive_input")

    const link = await resolveDomMutationAgentEffect({
      command: clickPoint(),
      observation: observation(),
      adapter: adapter({
        element: { ...canvas, tag: "a", href: "https://example.com/next" }
      }).instance,
      context: { screenshot: screenshot() }
    })
    expect(link.destination?.url).toBe("https://example.com/next")
    expect(link.semanticEffects).toContain("navigation")

    await expect(
      resolveDomMutationAgentEffect({
        command: clickPoint(),
        observation: observation(),
        adapter: adapter({
          element: { ...canvas, tag: "input", type: "checkbox", checked: false }
        }).instance,
        context: { screenshot: screenshot() }
      })
    ).rejects.toThrow(/check or uncheck/)
  })

  it("resolves a zoom as a read that touches nothing", async () => {
    const effect = await resolveReadOnlyAgentEffect({
      command: AgentCommandSchema.parse({
        type: "zoom",
        x: 1,
        y: 2,
        width: 300,
        height: 200,
        snapshotId: "snapshot-1",
        generation: 1
      }),
      observation: observation(),
      adapter: adapter().instance
    })
    expect(effect.semanticEffects).toEqual(["read"])
    expect(effect.target).toEqual({ sensitive: false, maySubmit: false })
  })
})

/**
 * A point is only ever a way of naming a control. Once the page says which
 * control lies under it, that control's own semantics decide what the step
 * costs — so a visual click can reach a canvas without becoming a cheaper
 * way to press Submit.
 */
describe("a visual click cannot outrank the control it lands on", () => {
  const policy = (
    effect: Awaited<ReturnType<typeof resolveDomMutationAgentEffect>>
  ) =>
    evaluateAgentPolicy({
      runId: "run-1",
      stepId: "run:1",
      effect,
      allowedOrigins: ["https://example.com"],
      scopedTabIds: [7],
      now: 3
    })

  const resolveOn = (element: AgentElement) =>
    resolveDomMutationAgentEffect({
      command: clickPoint(400, 300),
      observation: observation(),
      adapter: adapter({ element }).instance,
      context: { screenshot: screenshot() }
    })

  it("prices a point on a submit control as a submission", async () => {
    const effect = await resolveOn({
      ref: "e2",
      frameId: 0,
      tag: "button",
      type: "submit",
      name: "Place order",
      visible: true,
      enabled: true,
      editable: false,
      sensitive: false,
      submitter: true,
      maySubmit: true,
      formAction: "https://example.com/orders",
      formMethod: "post"
    })
    expect(effect.semanticEffects).toContain("submission")
    const decision = policy(effect)
    expect(decision.type).toBe("approval_required")
    expect(decision.risk).toBe("critical")
    if (decision.type !== "approval_required") return
    expect(decision.request.grantable).toBeUndefined()
  })

  it("hands a point on a sensitive control to the user", async () => {
    const decision = policy(
      await resolveOn({
        ref: "e3",
        frameId: 0,
        tag: "input",
        type: "password",
        visible: true,
        enabled: true,
        editable: true,
        sensitive: true
      })
    )
    expect(decision.type).toBe("takeover_required")
  })

  it("prices a point on a delete control as destructive", async () => {
    const decision = policy(
      await resolveOn({
        ref: "e4",
        frameId: 0,
        tag: "button",
        name: "Delete project",
        visible: true,
        enabled: true,
        editable: false,
        sensitive: false
      })
    )
    expect(decision.risk).toBe("critical")
  })

  it("still refuses a checkbox, which states a value rather than a toggle", async () => {
    await expect(
      resolveOn({
        ref: "e5",
        frameId: 0,
        tag: "input",
        type: "checkbox",
        visible: true,
        enabled: true,
        editable: true,
        sensitive: false
      })
    ).rejects.toBeInstanceOf(AgentGroundingError)
  })
})
