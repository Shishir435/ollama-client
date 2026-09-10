import type { AuthorizedAgentEffect } from "@ollama-client/agent-runtime"
import type { AgentObservation } from "@ollama-client/contracts"
import { describe, expect, it, vi } from "vitest"

import {
  type AgentDomMutationInstruction,
  AgentDomMutationInstructionSchema
} from "@/lib/browser-agent/control-port"
import {
  type AgentEffectResolverAdapter,
  resolveDomMutationAgentEffect
} from "@/lib/browser-agent/resolved-effect"
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
