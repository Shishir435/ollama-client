import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { FileAttachmentDisplay } from "@/features/chat/components/file-attachment-display"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { count?: number }) =>
      ({
        "common.loading": "Loading...",
        "prompts.selector.copy": "Copy",
        "tabs.inspector.chars": `${values?.count ?? 0} chars`
      })[key] ?? key
  })
}))

vi.mock("@/lib/embeddings/vector-store", () => ({
  getAllDocuments: vi.fn(async () => ({
    documents: [{ content: "full extracted text" }]
  }))
}))

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children, className }: React.ComponentProps<"div">) => (
    <div className={className}>{children}</div>
  )
}))

describe("FileAttachmentDisplay", () => {
  it("opens message attachment in a standardized preview sheet", async () => {
    render(
      <FileAttachmentDisplay
        attachments={[
          {
            fileId: "file-1",
            fileName: "prompt-templates.json",
            fileType: "application/json",
            fileSize: 3480,
            textPreview: "preview text",
            processedAt: 1
          }
        ]}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: /prompt-templates/i }))

    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(screen.getAllByText("prompt-templates.json").length).toBeGreaterThan(
      0
    )
    expect(screen.getAllByText("3.4 KB").length).toBeGreaterThan(0)

    await waitFor(() => {
      expect(screen.getByText("full extracted text")).toBeInTheDocument()
    })

    expect(screen.getByRole("dialog").textContent).toContain("19 chars")
  })
})
