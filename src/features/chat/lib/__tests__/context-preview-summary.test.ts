import { describe, expect, it } from "vitest"
import {
  getFileContextPreview,
  getQuotedSelectionPreview
} from "../context-preview-summary"

describe("context preview summary", () => {
  it("extracts quoted selected text from the composer input", () => {
    expect(getQuotedSelectionPreview("> hello\n> world\n\nQuestion?")).toEqual({
      text: "hello\nworld",
      charCount: 11
    })
  })

  it("returns null when no quoted selection is present", () => {
    expect(getQuotedSelectionPreview("Just a normal question")).toBeNull()
  })

  it("summarizes attached file context", () => {
    expect(
      getFileContextPreview([
        {
          file: new File([""], "ready.txt"),
          status: "success",
          result: {
            text: "file text",
            metadata: {
              fileName: "ready.txt",
              fileType: "text/plain",
              fileSize: 9,
              processedAt: 1
            }
          }
        },
        { file: new File([""], "pending.txt"), status: "processing" },
        { file: new File([""], "bad.txt"), status: "error", error: "bad" }
      ])
    ).toEqual({
      totalCount: 3,
      successCount: 1,
      processingCount: 1,
      errorCount: 1,
      charCount: 9
    })
  })
})
