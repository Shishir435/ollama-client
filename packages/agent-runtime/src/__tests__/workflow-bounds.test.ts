import type { AgentObservation, AgentRunState } from "@ollama-client/contracts"
import { expect, it, vi } from "vitest"
import { buildAgentWorkflow } from "../workflow"

/** Simulate a future budget smaller than even the fixed checkpoint metadata. */
vi.mock("@ollama-client/contracts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ollama-client/contracts")>()),
  MAX_AGENT_WORKFLOW_BYTES: 1
}))

it("omits fixed metadata that cannot fit instead of throwing from the deciding claim", () => {
  const state: AgentRunState = {
    version: 1,
    id: "run",
    goal: "Report the status",
    status: "observing",
    stepCount: 0,
    observationCount: 0,
    controlledTabId: 7,
    providerId: "ollama",
    modelId: "model",
    allowedOrigins: ["https://example.com"],
    createdAt: 1,
    updatedAt: 1,
    requirements: [{ id: "r1", text: "Report the status", kind: "read" }]
  }
  const observation: AgentObservation = {
    snapshotId: "now",
    generation: 1,
    tabId: 7,
    frameId: 0,
    documentId: "doc",
    url: "https://example.com",
    origin: "https://example.com",
    title: "Current",
    elements: [],
    visibleText: "Status: Active",
    dialogs: [],
    capturedAt: 1,
    frames: [],
    scroll: {
      x: 0,
      y: 0,
      viewportWidth: 100,
      viewportHeight: 100,
      documentWidth: 100,
      documentHeight: 100
    }
  }
  expect(buildAgentWorkflow(state, [], observation)).toBeUndefined()
})
