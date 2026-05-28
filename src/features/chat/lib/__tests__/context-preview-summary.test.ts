import { describe, expect, it } from "vitest"
import { getFileContextPreview } from "../context-preview-summary"

describe("context preview summary", () => {
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
