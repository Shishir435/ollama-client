import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SETTINGS } from "@/lib/storage/settings"
import { NativeEmbeddingAnnouncementDialog } from "../native-embedding-announcement-dialog"

const fixture = vi.hoisted(() => ({
  mode: "external",
  migration: "idle",
  failed: false,
  busy: false,
  dismissed: false,
  stage: "complete",
  settings: new Map<string, boolean>(),
  listeners: new Set<(changes: Record<string, unknown>) => void>(),
  command: vi.fn()
}))
vi.mock("../../hooks/use-native-embeddings", () => ({
  useNativeEmbeddings: () => ({
    state: {
      mode: fixture.mode,
      migration: fixture.migration,
      failed: fixture.failed,
      current: 3,
      total: 9
    },
    dismissed: fixture.dismissed,
    busy: fixture.busy,
    error: false,
    command: fixture.command
  })
}))
vi.mock("@/lib/browser-api", () => ({
  browser: {
    storage: {
      onChanged: {
        addListener: (listener: (changes: Record<string, unknown>) => void) =>
          fixture.listeners.add(listener),
        removeListener: (
          listener: (changes: Record<string, unknown>) => void
        ) => fixture.listeners.delete(listener)
      }
    }
  }
}))
vi.mock("@/lib/onboarding/state", () => ({
  getOnboardingState: async () => ({ stage: fixture.stage })
}))
vi.mock("@/lib/storage/setting-access", () => ({
  readSetting: async ({ key }: { key: string }) =>
    fixture.settings.get(key) ?? false
}))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const title = "settings.embeddings.bundled.title"
const renderSettled = async () => {
  await act(async () => {
    render(<NativeEmbeddingAnnouncementDialog />)
  })
}

describe("embedding upgrade announcement", () => {
  beforeEach(() => {
    vi.stubGlobal("__AGENT_PREVIEW_ENABLED__", true)
    fixture.mode = "external"
    fixture.migration = "idle"
    fixture.failed = false
    fixture.busy = false
    fixture.dismissed = false
    fixture.stage = "complete"
    fixture.settings.clear()
    fixture.listeners.clear()
    fixture.command.mockReset()
  })
  afterEach(() => vi.unstubAllGlobals())

  it("waits for the agent announcement and reacts to dismissal", async () => {
    await renderSettled()
    expect(screen.queryByRole("dialog")).toBeNull()
    fixture.settings.set(SETTINGS.AGENT_ANNOUNCEMENT_DISMISSED.key, true)
    await act(async () => {
      for (const listener of fixture.listeners)
        listener({ [SETTINGS.AGENT_ANNOUNCEMENT_DISMISSED.key]: {} })
    })
    expect(
      await screen.findByRole("dialog", { name: title })
    ).toBeInTheDocument()
    expect(fixture.command).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText("settings.embeddings.bundled.migrate"))
    expect(fixture.command).toHaveBeenCalledWith("start")
  })

  it("closes without migrating and persists the keep choice", async () => {
    fixture.settings.set(SETTINGS.AGENT_ENABLED.key, true)
    await renderSettled()
    fireEvent.click(await screen.findByRole("button", { name: "Close" }))
    expect(fixture.command).toHaveBeenCalledWith("dismiss")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("can close the announcement while migration is running", async () => {
    fixture.busy = true
    fixture.settings.set(SETTINGS.AGENT_ENABLED.key, true)
    await renderSettled()
    fireEvent.click(await screen.findByRole("button", { name: "Close" }))
    expect(fixture.command).toHaveBeenCalledWith("dismiss")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it.each([
    [false, ["common.cancel"]],
    [true, ["common.cancel", "settings.embeddings.bundled.resume"]]
  ] as const)("offers only valid rebuild controls (failed: %s)", async (failed, labels) => {
    fixture.migration = "building"
    fixture.failed = failed
    fixture.settings.set(SETTINGS.AGENT_ENABLED.key, true)
    await renderSettled()
    const dialog = await screen.findByRole("dialog", { name: title })
    const buttons = Array.from(dialog.querySelectorAll("button"))
      .map((button) => button.textContent)
      .filter(Boolean)
    expect(buttons).toEqual(labels)
    if (failed) {
      fireEvent.click(screen.getByText("settings.embeddings.bundled.resume"))
      expect(fixture.command).toHaveBeenCalledWith("resume")
    }
  })

  it("offers migration on Firefox without waiting for an absent agent", async () => {
    vi.stubGlobal("__AGENT_PREVIEW_ENABLED__", false)
    await renderSettled()
    expect(
      await screen.findByRole("dialog", { name: title })
    ).toBeInTheDocument()
    fireEvent.click(screen.getByText("settings.embeddings.bundled.keep"))
    expect(fixture.command).toHaveBeenCalledWith("keep")
  })

  it.each([
    "fresh",
    "dismissed",
    "onboarding"
  ])("does not show for %s profiles", async (profile) => {
    fixture.settings.set(SETTINGS.AGENT_ANNOUNCEMENT_DISMISSED.key, true)
    if (profile === "fresh") fixture.mode = "bundled"
    if (profile === "dismissed") fixture.dismissed = true
    if (profile === "onboarding") fixture.stage = "privacy"
    await renderSettled()
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(fixture.command).not.toHaveBeenCalled()
  })
})
