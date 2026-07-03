import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ProcessedFile } from "@/lib/file-processors/types"
import { useFileUpload } from "../use-file-upload"

vi.mock("@plasmohq/storage/hook", () => ({
  useStorage: vi.fn()
}))

vi.mock("@/lib/browser-api", () => ({
  browser: {
    runtime: {
      connect: vi.fn(),
      sendMessage: vi.fn()
    }
  }
}))

vi.mock("@/lib/file-processors", () => ({
  isFileTypeSupported: vi.fn(),
  processFile: vi.fn()
}))

vi.mock("@/lib/knowledge", () => ({
  processKnowledge: vi.fn()
}))

vi.mock("@/lib/knowledge/knowledge-sets", () => ({
  addFileToKnowledgeSet: vi.fn().mockResolvedValue(undefined),
  getActiveKnowledgeSetId: vi.fn().mockResolvedValue("knowledge-default"),
  markKnowledgeFileEmbedded: vi.fn().mockResolvedValue(undefined)
}))

vi.mock("@/lib/logger", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  }
}))

import { useStorage } from "@plasmohq/storage/hook"
import { browser } from "@/lib/browser-api"
import { isFileTypeSupported, processFile } from "@/lib/file-processors"
import { processKnowledge } from "@/lib/knowledge"

const fileUploadConfig = {
  maxFileSize: 10 * 1024 * 1024,
  autoEmbedFiles: false,
  showEmbeddingProgress: true,
  embeddingBatchSize: 2
}

const processedFile: ProcessedFile = {
  text: "hello world",
  metadata: {
    fileName: "notes.txt",
    fileType: "text/plain",
    fileSize: 11,
    processedAt: 123
  }
}

const createFile = () =>
  new File(["hello world"], "notes.txt", { type: "text/plain" })

describe("useFileUpload", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fileUploadConfig.autoEmbedFiles = false
    fileUploadConfig.showEmbeddingProgress = true
    fileUploadConfig.embeddingBatchSize = 2
    vi.mocked(useStorage).mockImplementation(((
      options: any,
      defaultValue: any
    ) => {
      const key =
        typeof options === "object" && options && "key" in options
          ? options.key
          : options

      if (key === "file-upload-config") {
        return [fileUploadConfig, vi.fn()]
      }

      return [defaultValue, vi.fn()]
    }) as any)

    vi.mocked(isFileTypeSupported).mockReturnValue(true)
    vi.mocked(processFile).mockResolvedValue({
      ...processedFile,
      metadata: { ...processedFile.metadata }
    })
    vi.mocked(processKnowledge).mockResolvedValue({
      success: true,
      chunkCount: 2,
      vectorIds: [1, 2]
    })
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
      success: true
    } as never)
  })

  it("calls onFileProcessed once when embeddings are disabled", async () => {
    const onFileProcessed = vi.fn()
    const { result } = renderHook(() => useFileUpload({ onFileProcessed }))

    await act(async () => {
      await result.current.processFiles([createFile()])
    })

    expect(onFileProcessed).toHaveBeenCalledTimes(1)
    expect(onFileProcessed).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "hello world",
        metadata: expect.objectContaining({
          fileName: "notes.txt",
          fileId: expect.stringMatching(/^file-/)
        })
      })
    )
  })

  it("calls onFileProcessed once after knowledge processing", async () => {
    fileUploadConfig.autoEmbedFiles = true
    const onFileProcessed = vi.fn()

    const { result } = renderHook(() => useFileUpload({ onFileProcessed }))

    await act(async () => {
      await result.current.processFiles([createFile()])
    })

    expect(processKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: "notes.txt",
        content: "hello world"
      })
    )
    expect(onFileProcessed).toHaveBeenCalledTimes(1)
    expect(browser.runtime.connect).not.toHaveBeenCalled()

    await waitFor(() => {
      expect(result.current.processingStates[0]).toEqual(
        expect.objectContaining({
          status: "success",
          progress: 100
        })
      )
    })
  })
})
