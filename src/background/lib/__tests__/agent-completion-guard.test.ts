import { describe, expect, it } from "vitest"

import type { ToolRun } from "@/types"
import {
  contractForAgentTask,
  createAgentCompletionGuard
} from "../agent-completion-guard"

const run = (toolId: string, status: ToolRun["status"] = "done"): ToolRun => ({
  toolId,
  label: toolId,
  status,
  startedAt: 1,
  completedAt: 2
})

describe("agent completion guard", () => {
  it("requires type, click, then observation for chat send tasks", () => {
    const guard = createAgentCompletionGuard(
      "say thank you to the chat input of the current tab"
    )

    expect(guard).toBeDefined()
    expect(guard?.([run("list_tabs"), run("current_tab")], "")).toMatchObject({
      allowed: false,
      feedback: expect.stringContaining("type action")
    })
    expect(
      guard?.([run("type"), run("snapshot_page"), run("click")], "")
    ).toMatchObject({
      allowed: false,
      feedback: expect.stringContaining("snapshot_page")
    })
    expect(
      guard?.([run("type"), run("click"), run("snapshot_page")], "")
    ).toEqual({ allowed: true })
  })

  it("does not count denied or failed actions as completion evidence", () => {
    const guard = createAgentCompletionGuard("click Save")

    expect(
      guard?.([run("click", "error"), run("snapshot_page")], "")
    ).toMatchObject({
      allowed: false,
      feedback: expect.stringContaining("click action")
    })
  })

  it("requires observation after typed text without requiring submit", () => {
    const guard = createAgentCompletionGuard("write thanks in the input")

    expect(guard?.([run("type")], "")).toMatchObject({ allowed: false })
    expect(guard?.([run("type"), run("snapshot_page")], "")).toEqual({
      allowed: true
    })
  })

  it("allows read-only answers but rejects unsupported action claims", () => {
    expect(contractForAgentTask("summarize this page")).toBeUndefined()
    const guard = createAgentCompletionGuard("what is on this page?")

    expect(
      guard([run("snapshot_page")], "This page describes a project.")
    ).toEqual({ allowed: true })
    expect(guard([run("current_tab")], "I replied to the chat.")).toMatchObject(
      {
        allowed: false,
        feedback: expect.stringContaining("no successful page-changing action")
      }
    )
  })

  it("rejects generic browser capability disclaimers", () => {
    const guard = createAgentCompletionGuard("find the recommended video")

    expect(
      guard(
        [run("snapshot_page", "error")],
        "I cannot directly interact with the DOM or click controls."
      )
    ).toMatchObject({
      allowed: false,
      feedback: expect.stringContaining("tools are available")
    })
  })

  it("marks a terminal read-tool error as failed", () => {
    const guard = createAgentCompletionGuard("find this text on the page")
    const decision = guard(
      [
        {
          ...run("find_in_page", "error"),
          error: "Requested text was not found."
        }
      ],
      "The requested text was not found."
    )

    expect(decision).toEqual({
      allowed: true,
      failureReason: "Requested text was not found."
    })
  })
})
