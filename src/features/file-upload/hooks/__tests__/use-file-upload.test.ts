import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ProcessedFile } from "@/lib/file-processors/types"
import { useFileUpload } from "../use-file-upload"

vi.mock("@plasmohq/storage/hook", () => ({
  useStorage: vi.fn()
}))

vi.mock("@/application/ingestion/ingestion-client", () => ({
  IngestionClient: {
    submitFile: vi.fn()
  }
}))

vi.mock("@/lib/file-processors", () => ({
  isFileTypeSupported: vi.fn()
}))

vi.mock("@/lib/logger", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  }
}))

import { useStorage } from "@plasmohq/storage/hook"
import { IngestionClient } from "@/application/ingestion/ingestion-client"
import { isFileTypeSupported } from "@/lib/file-processors"

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
    vi.mocked(IngestionClient.submitFile).mockResolvedValue({
      ...processedFile,
      metadata: {
        ...processedFile.metadata,
        fileId: "file-123",
        knowledgeSetId: "knowledge-default"
      }
    })
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

    expect(IngestionClient.submitFile).toHaveBeenCalledWith(
      expect.objectContaining({ name: "notes.txt" }),
      expect.objectContaining({ autoEmbed: true })
    )
    expect(onFileProcessed).toHaveBeenCalledTimes(1)

    await waitFor(() => {
      expect(result.current.processingStates[0]).toEqual(
        expect.objectContaining({
          status: "success",
          progress: 100
        })
      )
    })
  })

  it("keeps state from overlapping submissions", async () => {
    const first = new File(["one"], "one.txt", { type: "text/plain" })
    const second = new File(["two"], "two.txt", { type: "text/plain" })
    const resolvers = new Map<string, (value: ProcessedFile) => void>()
    vi.mocked(IngestionClient.submitFile).mockImplementation(
      (file) =>
        new Promise((resolve) => {
          resolvers.set(file.name, resolve)
        })
    )
    const { result } = renderHook(() => useFileUpload())

    let submissions: Promise<void>[] = []
    act(() => {
      submissions = [
        result.current.processFiles([first]),
        result.current.processFiles([second])
      ]
    })

    await waitFor(() => {
      expect(result.current.processingStates).toHaveLength(2)
      expect(
        result.current.processingStates.map((state) => state.file.name).sort()
      ).toEqual(["one.txt", "two.txt"])
    })

    await act(async () => {
      resolvers.get("one.txt")?.({
        ...processedFile,
        metadata: { ...processedFile.metadata, fileName: "one.txt" }
      })
      resolvers.get("two.txt")?.({
        ...processedFile,
        metadata: { ...processedFile.metadata, fileName: "two.txt" }
      })
      await Promise.all(submissions)
    })

    expect(
      result.current.processingStates.map((state) => state.status)
    ).toEqual(["success", "success"])
  })
})
