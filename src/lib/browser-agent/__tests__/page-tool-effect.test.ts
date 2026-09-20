import type { AuthorizedAgentEffect } from "@ollama-client/agent-runtime"
import {
  AgentCommandSchema,
  AgentObservationSchema
} from "@ollama-client/contracts"
import { describe, expect, it, vi } from "vitest"

import {
  executePageToolAgentEffect,
  resolvePageToolAgentEffect,
  verifyPageToolAgentEffect
} from "../page-tool-effect"

const observation = AgentObservationSchema.parse({
  snapshotId: "snapshot-1",
  generation: 1,
  tabId: 7,
  frameId: 0,
  documentId: "doc-1",
  url: "https://example.com/app",
  origin: "https://example.com",
  title: "Example",
  frames: [
    {
      frameId: 0,
      documentId: "doc-1",
      origin: "https://example.com",
      url: "https://example.com/app",
      access: "ok",
      snapshotId: "snapshot-1",
      generation: 1
    }
  ],
  elements: [],
  pageTools: [
    {
      name: "publish",
      description: "Publish the draft",
      inputSchema: { type: "object" },
      schemaRevision: "1234abcd",
      frameId: 0,
      documentId: "doc-1",
      origin: "https://example.com",
      annotations: { consequentialHint: true }
    }
  ],
  visibleText: "Draft",
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

const command = AgentCommandSchema.parse({
  type: "call_page_tool",
  snapshotId: "snapshot-1",
  generation: 1,
  toolName: "publish",
  schemaRevision: "1234abcd",
  frameId: 0,
  documentId: "doc-1",
  input: { id: "draft-1" }
})

describe("page-tool effect family", () => {
  it("binds the advertised tool and classifies it conservatively", async () => {
    const effect = await resolvePageToolAgentEffect({
      command,
      observation,
      adapter: {
        getTab: vi.fn(),
        classifyAccess: vi.fn().mockResolvedValue("ok"),
        resolveHistoryDestination: vi.fn()
      }
    })

    expect(effect.pageTool?.documentId).toBe("doc-1")
    expect(effect.semanticEffects).toEqual(["activation", "destructive"])
  })

  it.each([
    undefined,
    false,
    true
  ])("never lets consequentialHint=%s weaken authorization", async (consequentialHint) => {
    const pageTools = observation.pageTools?.map((tool) => ({
      ...tool,
      annotations: consequentialHint === undefined ? {} : { consequentialHint }
    }))
    const effect = await resolvePageToolAgentEffect({
      command,
      observation: { ...observation, pageTools },
      adapter: {
        getTab: vi.fn(),
        classifyAccess: vi.fn().mockResolvedValue("ok"),
        resolveHistoryDestination: vi.fn()
      }
    })

    expect(effect.semanticEffects).toEqual(["activation", "destructive"])
  })

  it("grounds an advertised child-frame tool to its own document", async () => {
    const childObservation = AgentObservationSchema.parse({
      ...observation,
      frames: [
        ...observation.frames,
        {
          frameId: 4,
          documentId: "child-doc",
          origin: "https://widgets.example",
          url: "https://widgets.example/editor",
          access: "ok",
          snapshotId: "child-snapshot",
          generation: 3
        }
      ],
      pageTools: [
        {
          ...observation.pageTools?.[0],
          frameId: 4,
          documentId: "child-doc",
          origin: "https://widgets.example"
        }
      ]
    })
    const childCommand = AgentCommandSchema.parse({
      ...command,
      frameId: 4,
      documentId: "child-doc"
    })
    const classifyAccess = vi.fn().mockResolvedValue("ok")

    const effect = await resolvePageToolAgentEffect({
      command: childCommand,
      observation: childObservation,
      adapter: {
        getTab: vi.fn(),
        classifyAccess,
        resolveHistoryDestination: vi.fn()
      }
    })

    expect(effect.pageTool).toMatchObject({
      frameId: 4,
      documentId: "child-doc"
    })
    expect(effect).toMatchObject({
      frameUrl: "https://widgets.example/editor",
      frameOrigin: "https://widgets.example"
    })
    expect(classifyAccess).toHaveBeenCalledWith(
      "https://widgets.example/editor"
    )
  })

  it("keeps a bounded result ephemeral until verification labels it untrusted", async () => {
    const resolved = await resolvePageToolAgentEffect({
      command,
      observation,
      adapter: {
        getTab: vi.fn(),
        classifyAccess: vi.fn().mockResolvedValue("ok"),
        resolveHistoryDestination: vi.fn()
      }
    })
    const effect = {
      ...resolved,
      authorization: { type: "policy", risk: "high", authorizedAt: 2 }
    } as AuthorizedAgentEffect
    const receipt = await executePageToolAgentEffect({
      effect,
      adapter: {
        getTab: vi.fn(),
        getFrame: vi.fn(),
        classifyAccess: vi.fn(),
        scroll: vi.fn(),
        mutate: vi.fn(),
        fillForm: vi.fn(),
        executePageTool: vi
          .fn()
          .mockResolvedValue({ result: "published", navigation: false }),
        activateTab: vi.fn(),
        goHistory: vi.fn(),
        resolveHistoryDestination: vi.fn(),
        wait: vi.fn(),
        navigate: vi.fn(),
        createTab: vi.fn(),
        now: () => 3
      },
      signal: { aborted: false }
    })
    const verified = await verifyPageToolAgentEffect({
      verification: {
        effect,
        receipt,
        before: observation,
        allowedOrigins: ["https://example.com"]
      },
      adapter: {
        observe: vi.fn(),
        getActiveTabId: vi.fn(),
        getTab: vi.fn(),
        classifyAccess: vi.fn(),
        now: () => 4
      },
      signal: { aborted: false }
    })

    expect(verified).toMatchObject({
      outcome: "confirmed",
      evidence: {
        kind: "page_tool_result",
        summary: "Untrusted page-tool result: published"
      }
    })
  })
})
