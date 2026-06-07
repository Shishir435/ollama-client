import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { FilePreview } from "@/features/file-upload/components/file-preview"
import type { FileProcessingState } from "@/lib/file-processors/types"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { count?: number }) =>
      ({
        "file_upload.preview.remove_aria_label": "Remove file",
        "file_upload.area.files_ready": `${values?.count ?? 1} file ready`,
        "tabs.inspector.chars": `${values?.count ?? 0} chars`
      })[key] ?? key
  })
}))

describe("FilePreview", () => {
  it("shows scrollable full extracted text and character count", () => {
    const longText = `${"intro ".repeat(100)}unique tail marker`
    const state: FileProcessingState = {
      file: new File(["content"], "resume.pdf", { type: "application/pdf" }),
      status: "success",
      result: {
        text: longText,
        metadata: {
          fileName: "resume.pdf",
          fileType: "application/pdf",
          fileSize: 7,
          processedAt: 1
        }
      }
    }

    render(<FilePreview processingState={state} onRemove={vi.fn()} />)

    fireEvent.click(screen.getByRole("button", { name: /resume.pdf/i }))

    expect(
      screen.getByText("unique tail marker", { exact: false })
    ).toBeInTheDocument()
    expect(screen.getByText(`${longText.length} chars`)).toBeInTheDocument()
  })

  it("can render as compact icon chip while keeping preview details", () => {
    const state: FileProcessingState = {
      file: new File(["content"], "prompt-templates.json", {
        type: "application/json"
      }),
      status: "success",
      result: {
        text: "template preview",
        metadata: {
          fileName: "prompt-templates.json",
          fileType: "application/json",
          fileSize: 7,
          processedAt: 1
        }
      }
    }

    render(<FilePreview processingState={state} onRemove={vi.fn()} compact />)

    expect(screen.queryByText("prompt-templates.json")).not.toBeInTheDocument()

    fireEvent.click(
      screen.getByRole("button", { name: "prompt-templates.json" })
    )

    expect(screen.getByText("prompt-templates.json")).toBeInTheDocument()
    expect(screen.getByText("template preview")).toBeInTheDocument()
  })
})
