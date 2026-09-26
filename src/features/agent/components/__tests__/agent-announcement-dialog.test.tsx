import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { SETTINGS } from "@/lib/storage/settings"
import { AgentAnnouncementDialog } from "../agent-announcement-dialog"

const store = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  onboardingStage: "complete"
}))

vi.mock("@/lib/storage/setting-access", () => ({
  readSetting: vi.fn(
    async (descriptor: { key: string; defaultValue?: unknown }) =>
      store.values.has(descriptor.key)
        ? store.values.get(descriptor.key)
        : descriptor.defaultValue
  ),
  writeSetting: vi.fn(async (descriptor: { key: string }, value: unknown) => {
    store.values.set(descriptor.key, value)
  })
}))

vi.mock("@/lib/onboarding/state", () => ({
  getOnboardingState: vi.fn(async () => ({
    version: 2,
    stage: store.onboardingStage
  }))
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe("AgentAnnouncementDialog", () => {
  beforeEach(() => {
    store.values.clear()
    store.onboardingStage = "complete"
  })

  it("is shown to a profile that finished onboarding and never closed it", async () => {
    render(<AgentAnnouncementDialog />)
    expect(
      await screen.findByText("agent.announcement.title")
    ).toBeInTheDocument()
    expect(
      screen.getByText("agent.announcement.hosted_models")
    ).toBeInTheDocument()
  })

  it("stays closed once dismissed", async () => {
    store.values.set(SETTINGS.AGENT_ANNOUNCEMENT_DISMISSED.key, true)
    render(<AgentAnnouncementDialog />)
    await waitFor(() => undefined)
    expect(screen.queryByText("agent.announcement.title")).toBeNull()
  })

  /** Two dialogs stacked on a first run get both dismissed unread. */
  it("waits for onboarding to finish", async () => {
    store.onboardingStage = "privacy"
    render(<AgentAnnouncementDialog />)
    await waitFor(() => undefined)
    expect(screen.queryByText("agent.announcement.title")).toBeNull()
  })

  it("records a dismissal without turning the agent on", async () => {
    render(<AgentAnnouncementDialog />)
    fireEvent.click(await screen.findByText("agent.announcement.later"))
    await waitFor(() =>
      expect(store.values.get(SETTINGS.AGENT_ANNOUNCEMENT_DISMISSED.key)).toBe(
        true
      )
    )
    expect(store.values.has(SETTINGS.AGENT_ENABLED.key)).toBe(false)
  })

  it("turns the agent on and records the dismissal", async () => {
    render(<AgentAnnouncementDialog />)
    fireEvent.click(await screen.findByText("agent.announcement.enable"))
    await waitFor(() =>
      expect(store.values.get(SETTINGS.AGENT_ANNOUNCEMENT_DISMISSED.key)).toBe(
        true
      )
    )
    expect(store.values.get(SETTINGS.AGENT_ENABLED.key)).toBe(true)
  })
})
