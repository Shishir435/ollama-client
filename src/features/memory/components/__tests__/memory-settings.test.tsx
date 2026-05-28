import { useStorage } from "@plasmohq/storage/hook"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { clearAllVectors, getStorageStats } from "@/lib/embeddings/vector-store"
import { MemorySettings } from "../memory-settings"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key
  })
}))

vi.mock("@plasmohq/storage/hook", () => ({
  useStorage: vi.fn()
}))

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() })
}))

vi.mock("@/lib/embeddings/vector-store", () => ({
  clearAllVectors: vi.fn(),
  getStorageStats: vi.fn()
}))

describe("MemorySettings", () => {
  const setMemoryEnabled = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useStorage).mockReturnValue([
      true,
      setMemoryEnabled,
      {
        setRenderValue: vi.fn(),
        setStoreValue: vi.fn().mockResolvedValue(null),
        remove: vi.fn(),
        isLoading: false
      }
    ])
    vi.mocked(getStorageStats).mockResolvedValue({
      totalVectors: 4,
      totalSizeMB: 1.25,
      byType: { chat: 3 }
    })
    vi.mocked(clearAllVectors).mockResolvedValue(3)
  })

  it("persists memory toggle changes", () => {
    render(<MemorySettings />)

    fireEvent.click(screen.getByRole("switch", { name: /enable.label/ }))

    expect(setMemoryEnabled).toHaveBeenCalledWith(
      false,
      expect.objectContaining({ reason: "none" })
    )
  })

  it("shows chat vector usage and clears chat memory after confirmation", async () => {
    render(<MemorySettings />)

    expect(await screen.findByText(/"count":3/)).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole("button", { name: /settings.memory.clear.button$/ })
    )
    fireEvent.click(
      await screen.findByRole("button", {
        name: /settings.memory.clear.button$/
      })
    )

    await waitFor(() => {
      expect(clearAllVectors).toHaveBeenCalledWith("chat")
    })
  })
})
