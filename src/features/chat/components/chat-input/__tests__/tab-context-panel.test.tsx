import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { TabContextPanel } from "../tab-context-panel"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { count?: number }) =>
      values?.count === undefined ? key : `${key}:${values.count}`
  })
}))

const options = [
  { value: "1", label: "One" },
  { value: "2", label: "Two" },
  { value: "3", label: "Three" }
]

const renderPanel = (props: {
  remoteProvider?: boolean
  selectedTabIds?: string[]
}) => {
  const toggleAllVisible = vi.fn()
  render(
    <TabContextPanel
      filteredTabOptions={options}
      allVisibleSelected={false}
      toggleAllVisible={toggleAllVisible}
      tabContents={{}}
      getTabStatus={() => ({ loading: false })}
      selectedTabIds={props.selectedTabIds ?? []}
      tabSearch=""
      setTabSearch={vi.fn()}
      refreshTabs={vi.fn()}
      toggleTab={vi.fn()}
      openPreview={vi.fn()}
      remoteProvider={props.remoteProvider}
    />
  )
  return toggleAllVisible
}

describe("TabContextPanel select all", () => {
  it("applies in one click for a local provider", () => {
    const toggleAllVisible = renderPanel({ remoteProvider: false })
    fireEvent.click(screen.getByLabelText("tabs.select.select_all"))
    expect(toggleAllVisible).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("asks first when many tabs would go to a remote provider", () => {
    const toggleAllVisible = renderPanel({ remoteProvider: true })
    fireEvent.click(screen.getByLabelText("tabs.select.select_all"))
    expect(toggleAllVisible).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toContain(
      "tabs.select.remote_confirm:3"
    )
    fireEvent.click(screen.getByText("tabs.select.remote_confirm_apply:3"))
    expect(toggleAllVisible).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("cancel leaves the selection alone", () => {
    const toggleAllVisible = renderPanel({ remoteProvider: true })
    fireEvent.click(screen.getByLabelText("tabs.select.select_all"))
    fireEvent.click(screen.getByText("tabs.select.remote_confirm_cancel"))
    expect(toggleAllVisible).not.toHaveBeenCalled()
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("does not ask when only one tab would be added", () => {
    const toggleAllVisible = renderPanel({
      remoteProvider: true,
      selectedTabIds: ["1", "2"]
    })
    fireEvent.click(screen.getByLabelText("tabs.select.select_all"))
    expect(toggleAllVisible).toHaveBeenCalledTimes(1)
  })
})

describe("TabContextPanel read issues", () => {
  const renderWithIssues = (
    issues: Record<string, import("@/lib/tab-read-issue").TabReadIssue>,
    contents: Record<number, { html: string }> = {}
  ) =>
    render(
      <TabContextPanel
        filteredTabOptions={options}
        allVisibleSelected={false}
        toggleAllVisible={vi.fn()}
        tabContents={contents}
        getTabStatus={(id) => ({ loading: false, issue: issues[id] ?? null })}
        selectedTabIds={[]}
        tabSearch=""
        setTabSearch={vi.fn()}
        refreshTabs={vi.fn()}
        toggleTab={vi.fn()}
        openPreview={vi.fn()}
      />
    )

  it("tells the user why a tab did not read, in place of an empty preview", () => {
    renderWithIssues({ "1": "pdf_file_access", "2": "pdf_no_text" })

    expect(
      screen.getByText("tabs.read_issue.pdf_file_access")
    ).toBeInTheDocument()
    /** Shared PDF reasons reuse the upload sentence, so it is translated once. */
    expect(
      screen.getByText("file_upload.errors.pdf_no_text")
    ).toBeInTheDocument()
    expect(screen.getAllByText("tabs.inspector.no_content")).toHaveLength(1)
  })

  it("keeps the content preview beside an issue about part of it", () => {
    renderWithIssues(
      { "1": "transcript_no_captions" },
      { 1: { html: "Video page text" } }
    )

    expect(
      screen.getByText("tabs.read_issue.transcript_no_captions")
    ).toBeInTheDocument()
    expect(screen.getByText("Video page text")).toBeInTheDocument()
  })

  it("shows nothing extra for a tab that read fine", () => {
    renderWithIssues({})
    expect(screen.queryByText(/tabs\.read_issue\./)).toBeNull()
    expect(screen.getAllByText("tabs.inspector.no_content")).toHaveLength(3)
  })
})
