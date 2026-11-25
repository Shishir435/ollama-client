import { useCallback, useState, useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import {
  IngestionClient,
  IngestionFailureError,
  IngestionObservationError
} from "@/application/ingestion/ingestion-client"
import { useSetting } from "@/hooks/use-setting"
import { DEFAULT_FILE_UPLOAD_CONFIG } from "@/lib/constants"
import { vectorStorageFullLimit } from "@/lib/embeddings/vector-storage-full"
import { pdfFailureCode } from "@/lib/file-processors/pdf-failure"
import type {
  FileProcessingState,
  ProcessedFile
} from "@/lib/file-processors/types"
import { logger } from "@/lib/logger"
import { SETTINGS } from "@/lib/storage/settings"
import {
  FileUploadValidationError,
  validateFileForUpload
} from "./file-upload-pipeline"
import { createUploadLimiter } from "./upload-limiter"

/** Files ingested at once; the rest wait their turn in submission order. */
export const UPLOAD_CONCURRENCY = 2

export interface UseFileUploadOptions {
  onFileProcessed?: (file: ProcessedFile) => void
  onError?: (error: Error) => void
  maxFileSize?: number
}

const buildSubmittedStates = (
  files: File[],
  maxFileSize: number,
  onError: ((error: Error) => void) | undefined,
  displayError: (error: unknown) => string
): Map<File, FileProcessingState> => {
  const submittedStates = new Map<File, FileProcessingState>()
  for (const file of files) {
    const error = validateFileForUpload(file, maxFileSize)
    if (error) {
      submittedStates.set(file, {
        file,
        status: "error",
        error: displayError(error)
      })
      onError?.(error)
      continue
    }
    submittedStates.set(file, { file, status: "queued" })
  }
  return submittedStates
}

const mergeProcessingStates = (
  previous: Map<File, FileProcessingState>,
  submitted: Map<File, FileProcessingState>
): Map<File, FileProcessingState> => {
  const next = new Map(previous)
  for (const [file, state] of submitted) next.set(file, state)
  return next
}

/** The ingestion failure as the user should read it: a known code in their language, anything else as recorded. */
const ingestionFailureMessage = (
  message: string,
  t: (key: string, values?: Record<string, unknown>) => string
): string => {
  const pdfCode = pdfFailureCode(message)
  if (pdfCode) return t(`file_upload.errors.pdf_${pdfCode}`)
  const max = vectorStorageFullLimit(message)
  return max === undefined
    ? message
    : t("file_upload.errors.storage_full", { max })
}

export function useFileUpload(options: UseFileUploadOptions = {}) {
  const observation = useRef(new AbortController())
  useEffect(() => {
    observation.current = new AbortController()
    return () => observation.current.abort()
  }, [])
  const { t } = useTranslation()
  const displayError = useCallback(
    (error: unknown) =>
      error instanceof FileUploadValidationError
        ? t(`file_upload.errors.${error.reason}`, {
            name: error.fileName,
            max: error.maxMb
          })
        : error instanceof IngestionObservationError
          ? t("errors.rpc.timeout")
          : error instanceof IngestionFailureError
            ? ingestionFailureMessage(error.message, t)
            : t("file_upload.errors.processing_failed"),
    [t]
  )
  const [config] = useSetting(SETTINGS.FILE_UPLOAD_CONFIG)
  const safeConfig = config || DEFAULT_FILE_UPLOAD_CONFIG
  const {
    onFileProcessed,
    onError,
    maxFileSize = safeConfig.maxFileSize
  } = options

  const [processingStates, setProcessingStates] = useState<
    Map<File, FileProcessingState>
  >(new Map())

  /**
   * Files the user removed, and the controller each running file answers to.
   * Removing a chip has to stop the work and keep it stopped: without this a
   * resolving ingestion wrote its state back and the chip reattached itself.
   */
  const removed = useRef(new WeakSet<File>())
  const controllers = useRef(new Map<File, AbortController>())
  /** Shared by every `processFiles` call, so two quick drops still run two at a time. */
  const limiter = useRef(createUploadLimiter(UPLOAD_CONCURRENCY))

  const setFileState = useCallback(
    (file: File, state: Omit<FileProcessingState, "file">) => {
      if (removed.current.has(file)) return
      setProcessingStates((previous) => {
        if (!previous.has(file)) return previous
        const next = new Map(previous)
        next.set(file, { file, ...state } as FileProcessingState)
        return next
      })
    },
    []
  )

  const processFile = useCallback(
    async (file: File): Promise<void> => {
      if (removed.current.has(file)) return
      const controller = new AbortController()
      controllers.current.set(file, controller)
      const signal = AbortSignal.any([
        observation.current.signal,
        controller.signal
      ])
      try {
        signal.throwIfAborted()
        setFileState(file, { status: "processing" })
        const result = await IngestionClient.submitFile(file, {
          autoEmbed: safeConfig.autoEmbedFiles,
          signal,
          onStatus: () => {
            if (signal.aborted || !safeConfig.showEmbeddingProgress) return
            /** No percentage is reported yet, so none is claimed: the bar stays indeterminate. */
            setFileState(file, { status: "processing" })
          }
        })

        if (signal.aborted || removed.current.has(file)) return
        setFileState(file, {
          status: "success",
          progress: safeConfig.showEmbeddingProgress ? 100 : undefined,
          result
        })
        onFileProcessed?.(result)
      } catch (error) {
        if (signal.aborted || removed.current.has(file)) return
        logger.error("File ingestion failed", "useFileUpload", { error })
        const errorMessage = displayError(error)
        setFileState(file, { status: "error", error: errorMessage })
        onError?.(new Error(errorMessage))
      } finally {
        if (controllers.current.get(file) === controller) {
          controllers.current.delete(file)
        }
      }
    },
    [
      onFileProcessed,
      onError,
      displayError,
      safeConfig.autoEmbedFiles,
      safeConfig.showEmbeddingProgress,
      setFileState
    ]
  )

  const processFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files)
      for (const file of fileArray) removed.current.delete(file)
      const submittedStates = buildSubmittedStates(
        fileArray,
        maxFileSize,
        onError
          ? (error) => onError(new Error(displayError(error)))
          : undefined,
        displayError
      )
      setProcessingStates((previous) =>
        mergeProcessingStates(previous, submittedStates)
      )

      const runnable = fileArray.filter(
        (file) => submittedStates.get(file)?.status !== "error"
      )
      await Promise.all(
        runnable.map((file) =>
          limiter.current(async () => {
            /**
             * Re-checked at the turn, not at submission: the user may have
             * removed the chip, or left, while it waited behind another file.
             */
            if (observation.current.signal.aborted) return
            if (removed.current.has(file)) return
            await processFile(file)
          })
        )
      )
    },
    [maxFileSize, onError, processFile, displayError]
  )

  const clearProcessingState = useCallback((file: File) => {
    removed.current.add(file)
    controllers.current.get(file)?.abort()
    setProcessingStates((prev) => {
      const next = new Map(prev)
      next.delete(file)
      return next
    })
  }, [])

  const clearAllProcessingStates = useCallback(() => {
    for (const [file, controller] of controllers.current) {
      removed.current.add(file)
      controller.abort()
    }
    setProcessingStates((previous) => {
      for (const file of previous.keys()) removed.current.add(file)
      return new Map()
    })
  }, [])

  return {
    processFiles,
    processingStates: Array.from(processingStates.values()),
    clearProcessingState,
    clearAllProcessingStates
  }
}

export type UseFileUploadReturn = ReturnType<typeof useFileUpload>
