import { useCallback, useState } from "react"
import { IngestionClient } from "@/application/ingestion/ingestion-client"
import { useSetting } from "@/hooks/use-setting"
import { DEFAULT_FILE_UPLOAD_CONFIG } from "@/lib/constants"
import { getDisplayErrorMessage } from "@/lib/error-display"
import type {
  FileProcessingState,
  ProcessedFile
} from "@/lib/file-processors/types"
import { SETTINGS } from "@/lib/storage/settings"
import { validateFileForUpload } from "./file-upload-pipeline"

export interface UseFileUploadOptions {
  onFileProcessed?: (file: ProcessedFile) => void
  onError?: (error: Error) => void
  maxFileSize?: number
}

const buildSubmittedStates = (
  files: File[],
  maxFileSize: number,
  onError?: (error: Error) => void
): Map<File, FileProcessingState> => {
  const submittedStates = new Map<File, FileProcessingState>()
  for (const file of files) {
    const error = validateFileForUpload(file, maxFileSize)
    if (error) {
      submittedStates.set(file, {
        file,
        status: "error",
        error: error.message
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

export function useFileUpload(options: UseFileUploadOptions = {}) {
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
      try {
        const result = await IngestionClient.submitFile(file, {
          autoEmbed: safeConfig.autoEmbedFiles,
          onStatus: () => {
            if (!safeConfig.showEmbeddingProgress) return
            setFileState(file, { status: "processing" })
          }
        })

        setFileState(file, {
          status: "success",
          progress: safeConfig.showEmbeddingProgress ? 100 : undefined,
          result
        })
        onFileProcessed?.(result)
      } catch (error) {
        const errorMessage = getDisplayErrorMessage(error, "Unknown error")
        setFileState(file, { status: "error", error: errorMessage })
        onError?.(error instanceof Error ? error : new Error(errorMessage))
      }
    },
    [
      onFileProcessed,
      onError,
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
      )
      setProcessingStates((previous) =>
        mergeProcessingStates(previous, submittedStates)
      )

      for (const file of fileArray) {
        if (submittedStates.get(file)?.status === "error") continue
        await processFile(file)
      }
    },
    [maxFileSize, onError, processFile]
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
