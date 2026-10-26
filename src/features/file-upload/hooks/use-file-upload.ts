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
    submittedStates.set(file, { file, status: "processing" })
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
const storageFullMessage = (
  message: string,
  t: (key: string, values?: Record<string, unknown>) => string
): string => {
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
            ? storageFullMessage(error.message, t)
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

  const setFileState = useCallback(
    (file: File, state: Omit<FileProcessingState, "file">) => {
      setProcessingStates((previous) => {
        const next = new Map(previous)
        next.set(file, { file, ...state } as FileProcessingState)
        return next
      })
    },
    []
  )

  const processFile = useCallback(
    async (file: File): Promise<void> => {
      const signal = observation.current.signal
      try {
        signal.throwIfAborted()
        const result = await IngestionClient.submitFile(file, {
          autoEmbed: safeConfig.autoEmbedFiles,
          signal,
          onStatus: () => {
            if (signal.aborted || !safeConfig.showEmbeddingProgress) return
            setFileState(file, { status: "processing" })
          }
        })

        if (signal.aborted) return
        setFileState(file, {
          status: "success",
          progress: safeConfig.showEmbeddingProgress ? 100 : undefined,
          result
        })
        onFileProcessed?.(result)
      } catch (error) {
        if (signal.aborted) return
        logger.error("File ingestion failed", "useFileUpload", { error })
        const errorMessage = displayError(error)
        setFileState(file, { status: "error", error: errorMessage })
        onError?.(new Error(errorMessage))
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

      for (const file of fileArray) {
        if (observation.current.signal.aborted) break
        if (submittedStates.get(file)?.status === "error") continue
        await processFile(file)
      }
    },
    [maxFileSize, onError, processFile, displayError]
  )

  const clearProcessingState = useCallback((file: File) => {
    setProcessingStates((prev) => {
      const next = new Map(prev)
      next.delete(file)
      return next
    })
  }, [])

  const clearAllProcessingStates = useCallback(() => {
    setProcessingStates(new Map())
  }, [])

  return {
    processFiles,
    processingStates: Array.from(processingStates.values()),
    clearProcessingState,
    clearAllProcessingStates
  }
}

export type UseFileUploadReturn = ReturnType<typeof useFileUpload>
