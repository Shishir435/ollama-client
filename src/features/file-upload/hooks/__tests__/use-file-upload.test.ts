import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ProcessedFile } from "@/lib/file-processors/types"
import { useFileUpload } from "../use-file-upload"

vi.mock("@plasmohq/storage/hook", () => ({
  useStorage: vi.fn()
}))

vi.mock("@/application/ingestion/ingestion-client", () => ({
  IngestionFailureError: class IngestionFailureError extends Error {},
  IngestionObservationError: class IngestionObservationError extends Error {},
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
import {
  IngestionClient,
  IngestionFailureError
} from "@/application/ingestion/ingestion-client"
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

  it("aborts panel observation on unmount and starts no remaining uploads", async () => {
    const onFileProcessed = vi.fn()
    const finishers: Array<(result: ProcessedFile) => void> = []
    vi.mocked(IngestionClient.submitFile).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishers.push(resolve)
        })
    )
    const { result, unmount } = renderHook(() =>
      useFileUpload({ onFileProcessed })
    )
    let processing!: Promise<void>
    act(() => {
      processing = result.current.processFiles([
        createFile(),
        new File(["two"], "two.txt", { type: "text/plain" }),
        new File(["three"], "three.txt", { type: "text/plain" })
      ])
    })
    const signal = vi.mocked(IngestionClient.submitFile).mock.calls[0][1].signal
    unmount()
    expect(signal?.aborted).toBe(true)
    await act(async () => {
      for (const finish of finishers) finish(processedFile)
      await processing
    })
    // Two run at once; the third was still waiting when the panel left.
    expect(IngestionClient.submitFile).toHaveBeenCalledTimes(2)
    expect(onFileProcessed).not.toHaveBeenCalled()
  })

  it("runs two uploads at a time and starts the next in submission order", async () => {
    const started: string[] = []
    const finishers = new Map<string, (result: ProcessedFile) => void>()
    vi.mocked(IngestionClient.submitFile).mockImplementation(
      (file: File) =>
        new Promise((resolve) => {
          started.push(file.name)
          finishers.set(file.name, resolve)
        })
    )
    const { result } = renderHook(() => useFileUpload())
    const names = ["a.txt", "b.txt", "c.txt", "d.txt"]
    let processing!: Promise<void>
    act(() => {
      processing = result.current.processFiles(
        names.map((name) => new File([name], name, { type: "text/plain" }))
      )
    })

    await waitFor(() => expect(started).toEqual(["a.txt", "b.txt"]))
    expect(
      result.current.processingStates.map((state) => state.status)
    ).toEqual(["processing", "processing", "queued", "queued"])

    // The later file finishing first frees a slot for the next in line only.
    await act(async () => finishers.get("b.txt")?.(processedFile))
    await waitFor(() => expect(started).toEqual(["a.txt", "b.txt", "c.txt"]))

    await act(async () => finishers.get("a.txt")?.(processedFile))
    await waitFor(() =>
      expect(started).toEqual(["a.txt", "b.txt", "c.txt", "d.txt"])
    )
    await act(async () => {
      finishers.get("c.txt")?.(processedFile)
      finishers.get("d.txt")?.(processedFile)
      await processing
    })
    expect(
      result.current.processingStates.map((state) => state.file.name)
    ).toEqual(names)
    expect(
      result.current.processingStates.every(
        (state) => state.status === "success"
      )
    ).toBe(true)
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

  it("preserves a known ingestion failure with actionable embedding details", async () => {
    vi.mocked(IngestionClient.submitFile).mockRejectedValueOnce(
      new IngestionFailureError(
        "Embedding provider is offline. Check its connection."
      )
    )
    const onError = vi.fn()
    const { result } = renderHook(() => useFileUpload({ onError }))
    await act(async () => {
      await result.current.processFiles([createFile()])
    })
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Embedding provider is offline. Check its connection."
      })
    )
  })

  it("tells the user in their language when the knowledge store is full", async () => {
    vi.mocked(IngestionClient.submitFile).mockRejectedValueOnce(
      new IngestionFailureError("vector_storage_full:100")
    )
    const onError = vi.fn()
    const { result } = renderHook(() => useFileUpload({ onError }))
    await act(async () => {
      await result.current.processFiles([createFile()])
    })
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("file_upload.errors.storage_full")
      })
    )
  })

  it("keeps a removed chip removed and starts no work for it", async () => {
    const onFileProcessed = vi.fn()
    const finishers: Array<(result: ProcessedFile) => void> = []
    const first = createFile()
    const second = new File(["two"], "two.txt", { type: "text/plain" })
    const third = new File(["three"], "three.txt", { type: "text/plain" })
    vi.mocked(IngestionClient.submitFile).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishers.push(resolve)
        })
    )
    const { result } = renderHook(() => useFileUpload({ onFileProcessed }))
    let processing!: Promise<void>
    act(() => {
      processing = result.current.processFiles([first, second, third])
    })
    expect(result.current.processingStates.map((s) => s.status)).toEqual([
      "processing",
      "processing",
      "queued"
    ])
    const signal = vi.mocked(IngestionClient.submitFile).mock.calls[0][1].signal
    act(() => {
      result.current.clearProcessingState(first)
      result.current.clearProcessingState(second)
      result.current.clearProcessingState(third)
    })
    expect(signal?.aborted).toBe(true)
    await act(async () => {
      for (const finish of finishers) finish(processedFile)
      await processing
    })
    expect(result.current.processingStates).toEqual([])
    expect(onFileProcessed).not.toHaveBeenCalled()
    expect(IngestionClient.submitFile).toHaveBeenCalledTimes(2)
  })

  it.each([
    ["pdf_failure:no_text", "file_upload.errors.pdf_no_text"],
    ["pdf_failure:password Failed to process PDF: x", "pdf_password"],
    ["pdf_failure:timeout Failed to process PDF: x", "pdf_timeout"],
    ["pdf_failure:corrupt Failed to process PDF: x", "pdf_corrupt"]
  ])("says why a PDF failed: %s", async (failure, expected) => {
    vi.mocked(IngestionClient.submitFile).mockRejectedValueOnce(
      new IngestionFailureError(failure)
    )
    const { result } = renderHook(() => useFileUpload())
    await act(async () => {
      await result.current.processFiles([createFile()])
    })
    const [state] = result.current.processingStates
    expect(state.status).toBe("error")
    expect(state.error).toContain(expected)
    expect(state.error).not.toContain("processing_failed")
  })

  it("keeps failing the remaining files with the storage-full message", async () => {
    vi.mocked(IngestionClient.submitFile).mockRejectedValue(
      new IngestionFailureError("vector_storage_full:100")
    )
    const { result } = renderHook(() => useFileUpload())
    await act(async () => {
      await result.current.processFiles([
        createFile(),
        new File(["two"], "two.txt", { type: "text/plain" }),
        new File(["three"], "three.txt", { type: "text/plain" })
      ])
    })
    expect(result.current.processingStates.map((state) => state.error)).toEqual(
      [
        expect.stringContaining("file_upload.errors.storage_full"),
        expect.stringContaining("file_upload.errors.storage_full"),
        expect.stringContaining("file_upload.errors.storage_full")
      ]
    )
  })
})
