import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { AttachmentList } from "@/features/chat/components/chat-input/attachment-list"
import type { FileProcessingState } from "@/lib/file-processors/types"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { count?: number }) =>
      ({
        "file_upload.preview.remove_aria_label": "Remove file",
        "file_upload.area.files_ready": `${values?.count ?? 0} files ready`,
        "tabs.inspector.chars": `${values?.count ?? 0} chars`
      })[key] ?? key
  })
}))

describe("AttachmentList", () => {
  it("shows attached files as expandable rows", () => {
    const onRemove = vi.fn()
    const longText = `${"template ".repeat(100)}tail marker`
    const state: FileProcessingState = {
      file: new File(["content"], "prompt-templates.json", {
        type: "application/json"
      }),
      status: "success",
      result: {
        text: longText,
        metadata: {
          fileName: "prompt-templates.json",
          fileType: "application/json",
          fileSize: 7,
          processedAt: 1
        }
      }
    }

    render(<AttachmentList processingStates={[state]} onRemove={onRemove} />)

    expect(screen.getByText("prompt-templates.json")).toBeInTheDocument()
    expect(screen.getByText(`${longText.length} chars`)).toBeInTheDocument()

    fireEvent.click(screen.getByText("prompt-templates.json"))

    expect(
      screen.getByText("tail marker", { exact: false })
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Remove file" }))
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it("shows an empty state when nothing is staged", () => {
    render(<AttachmentList processingStates={[]} onRemove={vi.fn()} />)
    expect(screen.getByText("0 files ready")).toBeInTheDocument()
  })
})
