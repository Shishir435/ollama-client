import type { AuthorizedAgentEffect } from "@ollama-client/agent-runtime"
import {
  type AgentObservation,
  AgentObservationSchema
} from "@ollama-client/contracts"
import { describe, expect, it, vi } from "vitest"

import {
  type AgentDomMutationInstruction,
  AgentDomMutationInstructionSchema
} from "@/lib/browser-agent/control-port"
import {
  type AgentEffectResolverAdapter,
  resolveDomMutationAgentEffect
} from "@/lib/browser-agent/resolved-effect"
import { browser } from "@/lib/browser-api"
import {
  createAgentBrowserAdapters,
  visibleTabCaptureSource
} from "../agent-browser-adapters"
import { createAgentControlSessionRegistry } from "../agent-control-sessions"
import { createAgentTabHistory } from "../agent-tab-history"

/**
 * The wire instruction the adapter builds must survive the strict schema the
 * background and the content script both parse it with. A resolved target
 * carries an internal frame identity; leaking it into that schema is a parse
 * failure that aborts the effect before it is sent, which is how a click
 * became a paused run rather than an action.
 */
const observation = (
  overrides: Partial<AgentObservation> = {}
): AgentObservation => ({
  snapshotId: "snapshot-1",
  generation: 1,
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
      snapshotId: "snapshot-1",
      generation: 1
    }
  ],
  elements: [
    {
      ref: "e1",
      frameId: 0,
      tag: "button",
      name: "Continue",
      visible: true,
      enabled: true,
      editable: false,
      sensitive: false
    }
  ],
  visibleText: "Continue",
  scroll: {
    x: 0,
    y: 0,
    viewportWidth: 100,
    viewportHeight: 100,
    documentWidth: 100,
    documentHeight: 100
  },
  dialogs: [],
  capturedAt: 1,
  ...overrides
})

const resolverAdapter: AgentEffectResolverAdapter = {
  getTab: async (tabId) => ({ id: tabId, url: "https://example.com/" }),
  classifyAccess: async () => "ok",
  resolveHistoryDestination: async () => undefined
}

const authorizedClick = async (): Promise<AuthorizedAgentEffect> => {
  const resolved = await resolveDomMutationAgentEffect({
    command: {
      type: "click",
      ref: "e1",
      snapshotId: "snapshot-1",
      generation: 1
    },
    observation: observation(),
    adapter: resolverAdapter
  })
  return {
    ...resolved,
    authorization: { type: "policy", risk: "low", authorizedAt: 1 }
  }
}

describe("Agent browser adapters", () => {
  it("builds a wire mutation the strict instruction schema accepts", async () => {
    let sent: AgentDomMutationInstruction | undefined
    const sessions = createAgentControlSessionRegistry({
      open: (async () => {
        throw new Error("no session in this test")
      }) as never
    })
    vi.spyOn(sessions, "executeDomMutation").mockImplementation(
      async ({ instruction }) => {
        // The real background parse before the request leaves the worker.
        sent = AgentDomMutationInstructionSchema.parse(instruction)
        return undefined
      }
    )
    const adapters = createAgentBrowserAdapters({
      runId: "run-1",
      sessions,
      history: createAgentTabHistory()
    })

    const effect = await authorizedClick()
    await expect(
      adapters.executor.mutate(effect, { aborted: false })
    ).resolves.toBeUndefined()

    expect(sent?.target).not.toHaveProperty("frame")
    expect(sent?.target.frameId).toBe(0)
    expect(sent?.frame).toMatchObject({ frameId: 0, documentId: "document-1" })
  })
})

describe("visible-tab capture fallback", () => {
  const viewport = () => ({ x: 0, y: 0, width: 800, height: 600 })
  const dataUrl = "data:image/jpeg;base64,/9j/AAAA"

  it("pictures the controlled tab only while it is the window's active tab, before and after", async () => {
    const active = { windowId: 3, active: true }
    const tabs = {
      get: vi.fn(async () => active),
      captureVisibleTab: vi.fn(async () => dataUrl)
    }
    const shot = await visibleTabCaptureSource(viewport, tabs).capture(
      7,
      undefined,
      { aborted: false }
    )
    expect(shot?.data).toBe("/9j/AAAA")
    expect(tabs.captureVisibleTab).toHaveBeenCalledWith(3, {
      format: "jpeg",
      quality: 80
    })
    expect(tabs.get).toHaveBeenCalledTimes(2)
  })

  it("returns nothing for a background tab, since the API pictures the active one instead", async () => {
    const tabs = {
      get: vi.fn(async () => ({ windowId: 3, active: false })),
      captureVisibleTab: vi.fn(async () => dataUrl)
    }
    await expect(
      visibleTabCaptureSource(viewport, tabs).capture(7, undefined, {
        aborted: false
      })
    ).resolves.toBeUndefined()
    expect(tabs.captureVisibleTab).not.toHaveBeenCalled()
  })

  it("discards a capture when the tab stopped being active while it was taken", async () => {
    const states = [
      { windowId: 3, active: true },
      { windowId: 3, active: false }
    ]
    const tabs = {
      get: vi.fn(async () => states.shift() ?? { windowId: 3, active: false }),
      captureVisibleTab: vi.fn(async () => dataUrl)
    }
    await expect(
      visibleTabCaptureSource(viewport, tabs).capture(7, undefined, {
        aborted: false
      })
    ).resolves.toBeUndefined()
  })
})

describe("observing a tab a native dialog is holding", () => {
  /**
   * The document's script is blocked, so the content script cannot answer at
   * all. Asking it anyway is a request that waits for a page that will not
   * reply until the dialog is answered — which is the thing the run is trying
   * to do.
   */
  const dialog = {
    id: "d1",
    type: "confirm" as const,
    message: "Delete this project?"
  }

  const withBlockedTab = () => {
    const sessions = createAgentControlSessionRegistry({
      open: (async () => {
        throw new Error("no session in this test")
      }) as never
    })
    const observe = vi
      .spyOn(sessions, "observe")
      .mockRejectedValue(new Error("the page is blocked"))
    const browserSessions = {
      capabilities: {
        backend: "cdp" as const,
        cdpControl: true,
        domControl: true as const,
        frameTracking: true
      },
      attach: vi.fn(),
      detach: vi.fn(),
      isAttached: () => true,
      attachedTabId: () => 7,
      frames: () => ({ status: "tracking" as const, frames: [] }),
      mapFrame: () => ({
        mapped: false as const,
        reason: "not_attached" as const
      }),
      subscribe: () => () => undefined,
      nativeInput: () => undefined,
      openDialog: vi.fn(() => dialog),
      handleDialog: vi.fn(async () => "answered" as const),
      dispose: vi.fn()
    }
    const extension = browser as unknown as Record<string, unknown>
    extension.tabs = {
      get: vi.fn(async () => ({
        id: 7,
        url: "https://example.com/board",
        title: "Board"
      }))
    }
    extension.webNavigation = {
      getFrame: vi.fn(async () => ({
        documentId: "document-9",
        url: "https://example.com/board"
      }))
    }
    const adapters = createAgentBrowserAdapters({
      runId: "run-1",
      sessions,
      browserSessions,
      history: createAgentTabHistory(),
      imageEditor: undefined,
      now: () => 5
    })
    return { adapters, observe }
  }

  it("reports the dialog and an unread page rather than asking the page", async () => {
    const { adapters, observe } = withBlockedTab()
    const blocked = await adapters.observation.observe(
      {
        runId: "run-1",
        tabId: 7,
        minimumGeneration: 3,
        allowedOrigins: ["https://example.com"]
      },
      { aborted: false }
    )
    expect(observe).not.toHaveBeenCalled()
    expect(AgentObservationSchema.parse(blocked)).toBeTruthy()
    expect(blocked.dialogs).toEqual([dialog])
    expect(blocked.elements).toEqual([])
    expect(blocked.visibleText).toBe("")
    expect(blocked.frames[0].access).toBe("unreadable")
    expect(blocked.documentId).toBe("document-9")
    expect(blocked.generation).toBeGreaterThanOrEqual(3)
    /** The snapshot names the dialog, so it cannot be reused on the page. */
    expect(blocked.snapshotId).toContain("d1")
  })

  it("keeps the verifier off the blocked page too", async () => {
    // The verifier observes through the same seam, so a second dialog opened
    // by the page cannot leave it waiting on a document that is frozen.
    const { adapters, observe } = withBlockedTab()
    const blocked = await adapters.verifier.observe(
      7,
      4,
      ["https://example.com"],
      { aborted: false }
    )
    expect(observe).not.toHaveBeenCalled()
    expect(blocked.dialogs).toEqual([dialog])
  })
})
