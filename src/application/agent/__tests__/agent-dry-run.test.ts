import type { AgentObservation, AgentRunState } from "@ollama-client/contracts"
import { describe, expect, it, vi } from "vitest"
import { proposeAgentDryRunStep } from "../agent-dry-run"

const state: AgentRunState = {
  version: 1,
  id: "run-1",
  goal: "Inspect the page",
  status: "submitted",
  stepCount: 0,
  observationCount: 0,
  controlledTabId: 7,
  providerId: "ollama",
  modelId: "qwen",
  allowedOrigins: ["https://example.com"],
  createdAt: 1,
  updatedAt: 1
}

const observation: AgentObservation = {
  snapshotId: "snapshot-1",
  generation: 1,
  tabId: 7,
  documentId: "document-1",
  url: "https://example.com/",
  origin: "https://example.com",
  title: "Example",
  elements: [],
  visibleText: "Page",
  scroll: {
    x: 0,
    y: 0,
    viewportWidth: 100,
    viewportHeight: 100,
    documentWidth: 100,
    documentHeight: 100
  },
  dialogs: [],
  capturedAt: 1
}

describe("proposeAgentDryRunStep", () => {
  it("observes and returns one proposal without an effect port", async () => {
    const observe = vi.fn(async () => observation)
    const decide = vi.fn(async () => ({
      type: "command" as const,
      command: {
        type: "read" as const,
        snapshotId: observation.snapshotId,
        generation: observation.generation
      }
    }))

    await expect(
      proposeAgentDryRunStep({
        state,
        observation: { observe },
        model: { decide },
        signal: { aborted: false }
      })
    ).resolves.toMatchObject({ decision: { type: "command" } })
    expect(observe).toHaveBeenCalledOnce()
    expect(decide).toHaveBeenCalledOnce()
  })

  it("rejects a proposal grounded in another snapshot", async () => {
    await expect(
      proposeAgentDryRunStep({
        state,
        observation: { observe: async () => observation },
        model: {
          decide: async () => ({
            type: "command",
            command: {
              type: "read",
              snapshotId: "stale",
              generation: 0
            }
          })
        },
        signal: { aborted: false }
      })
    ).rejects.toThrow("not grounded")
  })
})
