import { describe, expect, it, vi } from "vitest"
import { SETTINGS } from "@/lib/storage/settings"
import {
  AgentReviewerUnavailableError,
  resolveAgentCompletionReviewer
} from "../agent-completion-reviewer"

vi.mock("../agent-provider-disclosure", () => ({
  resolveAgentProviderDisclosure: vi.fn()
}))

const run = { providerId: "ollama", modelId: "qwen3" }
const judge = { providerId: "custom:lab", modelId: "judge-1" }

const settings = (values: {
  reviewer?: { providerId: string; modelId: string } | null
  acknowledged?: boolean
}) =>
  vi.fn(async (setting: unknown) =>
    setting === SETTINGS.AGENT_COMPLETION_REVIEWER
      ? (values.reviewer ?? null)
      : setting === SETTINGS.AGENT_REMOTE_OBSERVATION_ACKNOWLEDGED
        ? (values.acknowledged ?? false)
        : undefined
  ) as never

const located = (location: "local" | "remote") =>
  vi.fn(async () => ({
    name: "Lab",
    model: judge.modelId,
    location,
    readiness: { status: "ready" }
  })) as never

describe("resolveAgentCompletionReviewer", () => {
  it("is the run's own model when nothing else is configured", async () => {
    const disclose = located("remote")
    await expect(
      resolveAgentCompletionReviewer(run, { read: settings({}), disclose })
    ).resolves.toEqual(run)
    expect(disclose).not.toHaveBeenCalled()
  })

  it("asks no disclosure question when the configured reviewer is the run's model", async () => {
    const disclose = located("remote")
    await expect(
      resolveAgentCompletionReviewer(run, {
        read: settings({ reviewer: run }),
        disclose
      })
    ).resolves.toEqual(run)
    expect(disclose).not.toHaveBeenCalled()
  })

  it("uses a configured reviewer on this device", async () => {
    await expect(
      resolveAgentCompletionReviewer(run, {
        read: settings({ reviewer: judge }),
        disclose: located("local")
      })
    ).resolves.toEqual(judge)
  })

  it("refuses a remote reviewer until page content may reach remote models", async () => {
    await expect(
      resolveAgentCompletionReviewer(run, {
        read: settings({ reviewer: judge, acknowledged: false }),
        disclose: located("remote")
      })
    ).rejects.toMatchObject({
      name: "AgentReviewerUnavailableError",
      reason: "remote_not_acknowledged"
    })
    await expect(
      resolveAgentCompletionReviewer(run, {
        read: settings({ reviewer: judge, acknowledged: true }),
        disclose: located("remote")
      })
    ).resolves.toEqual(judge)
  })

  it("refuses a reviewer whose provider is gone rather than quietly using another", async () => {
    await expect(
      resolveAgentCompletionReviewer(run, {
        read: settings({ reviewer: judge }),
        disclose: vi.fn(async () => undefined) as never
      })
    ).rejects.toBeInstanceOf(AgentReviewerUnavailableError)
  })
})
