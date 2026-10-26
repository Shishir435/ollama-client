import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { StorageFullNotice } from "../storage-full-notice"

const mocks = vi.hoisted(() => ({
  settings: { full: null as unknown, limit: 100 },
  openOptionsInTab: vi.fn()
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { max?: number }) =>
      values?.max === undefined ? key : `${key}:${values.max}`
  })
}))

vi.mock("@/lib/browser-api", () => ({
  openOptionsInTab: mocks.openOptionsInTab,
  runtime: { getURL: (path: string) => `chrome-extension://test/${path}` }
}))

vi.mock("@/hooks/use-setting", () => ({
  useSetting: (descriptor: { key: string }) => [
    descriptor.key === "embeddings-storage-full"
      ? mocks.settings.full
      : { maxStorageSize: mocks.settings.limit }
  ]
}))

describe("StorageFullNotice", () => {
  beforeEach(() => {
    mocks.settings = { full: null, limit: 100 }
    mocks.openOptionsInTab.mockClear()
  })

  it("shows nothing while the store has room", () => {
    const { container } = render(<StorageFullNotice />)
    expect(container).toBeEmptyDOMElement()
  })

  it("names the limit and opens the setting that raises it", () => {
    mocks.settings.full = { limitMB: 100, at: 1 }
    render(<StorageFullNotice />)

    expect(screen.getByText("chat.storage_full.description:100")).toBeTruthy()
    fireEvent.click(screen.getByRole("button"))
    expect(mocks.openOptionsInTab).toHaveBeenCalledWith(
      "chrome-extension://test/options.html?tab=knowledge&focus=max-storage-size"
    )
  })

  it("goes away once the limit is raised or removed", () => {
    mocks.settings.full = { limitMB: 100, at: 1 }
    mocks.settings.limit = 200
    const raised = render(<StorageFullNotice />)
    expect(raised.container).toBeEmptyDOMElement()
    raised.unmount()

    mocks.settings.limit = 0
    const removed = render(<StorageFullNotice />)
    expect(removed.container).toBeEmptyDOMElement()
  })
})
