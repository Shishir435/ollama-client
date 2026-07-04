import { describe, expect, it } from "vitest"
import type { AgentRun } from "@/lib/repositories/agent-runs"
import { serializeAgentRunLog } from "../agent-log"

describe("agent log export", () => {
  it("redacts typed values and credential-shaped fields", () => {
    const run = {
      id: "run-1",
      sessionId: "session-1",
      status: "paused",
      state: {
        task: "Fill the form",
        targetTabId: 7,
        allowedOrigins: ["https://example.com"],
        steps: [
          {
            id: "step-1",
            kind: "observe",
            label: "Observed",
            status: "done",
            startedAt: 1,
            result: 'input "Email" (value="person@example.com")'
          }
        ],
        pendingAction: {
          action: "type",
          snapshotId: "snapshot-1",
          elementId: 2,
          textLength: 12
        },
        modelTurns: 1,
        actionCount: 0,
        activeMs: 100
      },
      createdAt: 1,
      updatedAt: 2,
      token: "secret-token"
    } as AgentRun & { token: string }

    const exported = serializeAgentRunLog(run)

    expect(exported).not.toContain("secret-token")
    expect(exported).not.toContain("person@example.com")
    expect(exported).not.toContain('"textLength": 12')
    expect(exported).toContain('"task": "Fill the form"')
  })
})
