import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  openTabs: [] as Array<{ id: number; title?: string; url?: string }>
}))

vi.mock("@/lib/tools/internal/tab-utils", () => ({
  requestPageContentWithRecovery: mocks.request
}))
vi.mock("@/features/tabs/hooks/use-open-tab", () => ({
  useOpenTabs: () => ({ tabs: mocks.openTabs, refreshTabs: vi.fn() })
}))
vi.mock("@/hooks/use-setting", () => ({
  useSetting: () => [false, vi.fn(), { isLoading: false }]
}))

import { useSelectedTabsStore } from "@/features/tabs/stores/selected-tabs-store"
import { useTabContents } from "../use-tab-contents"

/** Distinct ids per test: the fetching store is module-level and persists. */
let nextTabId = 5000
const freshTabId = () => ++nextTabId

const select = (tabId: number, tab: { title?: string; url?: string } = {}) => {
  mocks.openTabs = [
    { id: tabId, title: "Tab", url: "https://example.com/", ...tab }
  ]
  useSelectedTabsStore.setState({ selectedTabIds: [String(tabId)], errors: {} })
}

describe("useTabContents read issues", () => {
  beforeEach(() => {
    mocks.request.mockReset()
    useSelectedTabsStore.setState({ selectedTabIds: [], errors: {} })
  })

  it("keeps the model's text for a PDF that has no text and gives the user the reason", async () => {
    const tabId = freshTabId()
    select(tabId, { url: "https://example.com/scan.pdf" })
    mocks.request.mockResolvedValue({
      success: false,
      reason: "error",
      issue: "pdf_no_text",
      html: "The PDF has no selectable text. Do not retry.",
      title: "scan.pdf"
    })

    const { result } = renderHook(() => useTabContents())
    await waitFor(() =>
      expect(result.current.issues[tabId]).toBe("pdf_no_text")
    )

    /** The model reads its own sentence; the failure is not stored as page content. */
    expect(useSelectedTabsStore.getState().errors[tabId]).toBe(
      "The PDF has no selectable text. Do not retry."
    )
    expect(result.current.tabContents[tabId]).toBeUndefined()
    expect(result.current.loadingIds[tabId]).toBe(false)
  })

  it("does not download a scanned PDF again just because the tab list changed", async () => {
    const tabId = freshTabId()
    select(tabId)
    mocks.request.mockResolvedValue({
      success: false,
      issue: "pdf_password",
      html: "locked"
    })

    const { result, rerender } = renderHook(() => useTabContents())
    await waitFor(() =>
      expect(result.current.issues[tabId]).toBe("pdf_password")
    )
    mocks.openTabs = [
      { id: tabId, title: "Renamed", url: "https://example.com/" }
    ]
    rerender()
    await act(async () => {})

    expect(mocks.request).toHaveBeenCalledTimes(1)
  })

  it("tries a slow PDF again on the next tab-list change", async () => {
    const tabId = freshTabId()
    select(tabId)
    mocks.request.mockResolvedValue({
      success: false,
      issue: "pdf_timeout",
      html: "slow"
    })

    const { result, rerender } = renderHook(() => useTabContents())
    await waitFor(() =>
      expect(result.current.issues[tabId]).toBe("pdf_timeout")
    )
    mocks.openTabs = [
      { id: tabId, title: "Renamed", url: "https://example.com/" }
    ]
    rerender()

    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2))
  })

  it("keeps a video's page and tells the user it has no captions", async () => {
    const tabId = freshTabId()
    select(tabId)
    mocks.request.mockResolvedValue({
      success: true,
      html: "Video URL: x\nTranscript:\n\nNo transcript is available",
      title: "Video",
      issue: "transcript_no_captions"
    })

    const { result } = renderHook(() => useTabContents())
    await waitFor(() =>
      expect(result.current.issues[tabId]).toBe("transcript_no_captions")
    )

    expect(result.current.tabContents[tabId]?.html).toContain("Video URL")
    expect(useSelectedTabsStore.getState().errors[tabId]).toBeUndefined()
  })

  it("clears the issue and the old error once a later read succeeds", async () => {
    const tabId = freshTabId()
    select(tabId)
    mocks.request.mockResolvedValueOnce({
      success: false,
      issue: "pdf_file_access",
      html: "no file access"
    })
    const { result } = renderHook(() => useTabContents())
    await waitFor(() =>
      expect(result.current.issues[tabId]).toBe("pdf_file_access")
    )

    mocks.request.mockResolvedValueOnce({
      success: true,
      html: "text",
      title: "T"
    })
    await act(async () => {
      await result.current.refreshSelectedTabContents()
    })

    expect(result.current.issues[tabId]).toBeUndefined()
    expect(useSelectedTabsStore.getState().errors[tabId]).toBeUndefined()
    expect(result.current.tabContents[tabId]?.html).toBe("text")
  })

  it("explains a restricted page without reading it", async () => {
    const tabId = freshTabId()
    select(tabId, { url: "chrome://settings" })

    const { result } = renderHook(() => useTabContents())
    await waitFor(() => expect(result.current.issues[tabId]).toBe("restricted"))

    expect(mocks.request).not.toHaveBeenCalled()
    /** The model-facing sentence is still what the context carries. */
    expect(useSelectedTabsStore.getState().errors[tabId]).toContain(
      "Do not retry this same tab"
    )
  })

  it("asks the user to reload a tab with no content script", async () => {
    const tabId = freshTabId()
    select(tabId)
    mocks.request.mockRejectedValue(
      new Error("Could not establish connection. Receiving end does not exist.")
    )

    const { result } = renderHook(() => useTabContents())
    await waitFor(() => expect(result.current.issues[tabId]).toBe("tab_reload"))
  })
})
