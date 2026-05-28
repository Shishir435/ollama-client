import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_EMBEDDING_CONFIG } from "@/lib/constants"
import type { ProcessedFile } from "@/lib/file-processors/types"
import { useFileUpload } from "../use-file-upload"

vi.mock("@plasmohq/storage/hook", () => ({
  useStorage: vi.fn()
}))

vi.mock("@/lib/browser-api", () => ({
  browser: {
    runtime: {
      connect: vi.fn()
    }
  }
}))

vi.mock("@/lib/embeddings/chunker", () => ({
  chunkTextAsync: vi.fn()
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
import { chunkTextAsync } from "@/lib/embeddings/chunker"
import { isFileTypeSupported, processFile } from "@/lib/file-processors"
import { processKnowledge } from "@/lib/knowledge"

const fileUploadConfig = {
  maxFileSize: 10 * 1024 * 1024,
  autoEmbedFiles: false,
  showEmbeddingProgress: true,
  embeddingBatchSize: 2
}

const embeddingConfig = {
  ...DEFAULT_EMBEDDING_CONFIG,
  useEnhancedChunking: true
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

const createMockPort = () => ({
  postMessage: vi.fn(),
  disconnect: vi.fn(),
  onMessage: {
    addListener: vi.fn()
  }
})

describe("useFileUpload", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fileUploadConfig.autoEmbedFiles = false
    fileUploadConfig.showEmbeddingProgress = true
    fileUploadConfig.embeddingBatchSize = 2
    embeddingConfig.useEnhancedChunking = true

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

      if (key === "embeddings-config") {
        return [embeddingConfig, vi.fn()]
      }

      return [defaultValue, vi.fn()]
    }) as any)

    vi.mocked(isFileTypeSupported).mockReturnValue(true)
    vi.mocked(processFile).mockResolvedValue({
      ...processedFile,
      metadata: { ...processedFile.metadata }
    })
    vi.mocked(chunkTextAsync).mockResolvedValue([
      { index: 0, text: "hello", startPos: 0, endPos: 5 },
      { index: 1, text: "world", startPos: 6, endPos: 11 }
    ])
    vi.mocked(processKnowledge).mockResolvedValue({
      success: true,
      chunkCount: 2,
      vectorIds: [1, 2]
    })
    vi.mocked(browser.runtime.connect).mockReturnValue(createMockPort() as any)
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

  it("calls onFileProcessed once after queueing legacy embedding chunks", async () => {
    fileUploadConfig.autoEmbedFiles = true
    embeddingConfig.useEnhancedChunking = false
    const onFileProcessed = vi.fn()
    const port = createMockPort()
    vi.mocked(browser.runtime.connect).mockReturnValue(port as any)

    const { result } = renderHook(() => useFileUpload({ onFileProcessed }))

    await act(async () => {
      await result.current.processFiles([createFile()])
    })

    expect(chunkTextAsync).toHaveBeenCalledWith(
      "hello world",
      expect.objectContaining({
        chunkSize: embeddingConfig.chunkSize,
        chunkOverlap: embeddingConfig.chunkOverlap,
        strategy: embeddingConfig.chunkingStrategy
      })
    )
    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "init" })
    )
    expect(port.postMessage).toHaveBeenCalledWith({ type: "done" })
    expect(onFileProcessed).toHaveBeenCalledTimes(1)
  })

  it("calls onFileProcessed once after enhanced knowledge processing", async () => {
    fileUploadConfig.autoEmbedFiles = true
    embeddingConfig.useEnhancedChunking = true
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
