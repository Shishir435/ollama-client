import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { FilePreview } from "@/features/file-upload/components/file-preview"
import type { FileProcessingState } from "@/lib/file-processors/types"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (
      key: string,
      values?: {
        count?: number
        name?: string
        status?: string
        error?: string
      }
    ) =>
      ({
        "file_upload.preview.aria_label": `${values?.name}, ${values?.status}`,
        "file_upload.preview.aria_label_error": `${values?.name}, ${values?.status}: ${values?.error}`,
        "file_upload.preview.status.error": "failed",
        "file_upload.preview.status.queued": "queued",
        "file_upload.preview.status.processing": "processing",
        "file_upload.preview.status.success": "ready",
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
      screen.getByRole("button", { name: "prompt-templates.json, ready" })
    )

    expect(screen.getByText("prompt-templates.json")).toBeInTheDocument()
    expect(screen.getByText("template preview")).toBeInTheDocument()
  })

  it("puts status and the error text into the chip's accessible name", () => {
    const file = new File(["x"], "big.pdf", { type: "application/pdf" })
    render(
      <FilePreview
        processingState={{ file, status: "error", error: "Too large" }}
        onRemove={vi.fn()}
      />
    )
    expect(
      screen.getByRole("button", { name: "big.pdf, failed: Too large" })
    ).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("Too large")
  })

  it("names a waiting file as queued, not as busy", () => {
    const file = new File(["x"], "next.pdf", { type: "application/pdf" })
    render(
      <FilePreview
        processingState={{ file, status: "queued" }}
        onRemove={vi.fn()}
      />
    )
    expect(
      screen.getByRole("button", { name: "next.pdf, queued" })
    ).toBeInTheDocument()
  })

  it("draws an indeterminate bar, not a percentage, while processing", () => {
    const file = new File(["x"], "doc.pdf", { type: "application/pdf" })
    render(
      <FilePreview
        processingState={{ file, status: "processing" }}
        onRemove={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: /doc.pdf/ }))
    expect(screen.queryByText(/%/)).toBeNull()
  })
})
