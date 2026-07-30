import { useStorage } from "@plasmohq/storage/hook"
import { useCallback, useState } from "react"
import { IngestionClient } from "@/application/ingestion/ingestion-client"
import { DEFAULT_FILE_UPLOAD_CONFIG, STORAGE_KEYS } from "@/lib/constants"
import { getDisplayErrorMessage } from "@/lib/error-display"
import type {
  FileProcessingState,
  ProcessedFile
} from "@/lib/file-processors/types"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type { FileUploadConfig } from "@/types"
import { validateFileForUpload } from "./file-upload-pipeline"

export interface UseFileUploadOptions {
  onFileProcessed?: (file: ProcessedFile) => void
  onError?: (error: Error) => void
  maxFileSize?: number
}

export function useFileUpload(options: UseFileUploadOptions = {}) {
  const [config] = useStorage<FileUploadConfig>(
    {
      key: STORAGE_KEYS.FILE_UPLOAD.CONFIG,
      instance: plasmoGlobalStorage
    },
    DEFAULT_FILE_UPLOAD_CONFIG
  )

  const safeConfig = config || DEFAULT_FILE_UPLOAD_CONFIG
  const {
    onFileProcessed,
    onError,
    maxFileSize = safeConfig.maxFileSize
  } = options

  const [processingStates, setProcessingStates] = useState<
    Map<File, FileProcessingState>
  >(new Map())

  const processFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files)
      const newStates = new Map(processingStates)

      // Initialize processing states
      for (const file of fileArray) {
        const error = validateFileForUpload(file, maxFileSize)
        if (error) {
          newStates.set(file, {
            file,
            status: "error",
            error: error.message
          })
          if (onError) onError(error)
          continue
        }

        newStates.set(file, {
          file,
          status: "processing"
        })
      }

      setProcessingStates(newStates)

      // Process each file
      for (const file of fileArray) {
        // Skip if already has error
        const currentState = newStates.get(file)
        if (currentState?.status === "error") continue

        try {
          const result = await IngestionClient.submitFile(file, {
            autoEmbed: safeConfig.autoEmbedFiles,
            onStatus: (_job, processedFile) => {
              if (!safeConfig.showEmbeddingProgress) return
              setProcessingStates((prev) => {
                const next = new Map(prev)
                next.set(file, {
                  file,
                  status: "processing",
                  result: processedFile
                })
                return next
              })
            }
          })

          setProcessingStates((prev) => {
            const next = new Map(prev)
            next.set(file, {
              file,
              status: "success",
              progress: safeConfig.showEmbeddingProgress ? 100 : undefined,
              result
            })
            return next
          })

          if (onFileProcessed) {
            onFileProcessed(result)
          }
        } catch (error) {
          const errorMessage = getDisplayErrorMessage(error, "Unknown error")
          setProcessingStates((prev) => {
            const next = new Map(prev)
            next.set(file, {
              file,
              status: "error",
              error: errorMessage
            })
            return next
          })

          if (onError) {
            onError(error instanceof Error ? error : new Error(errorMessage))
          }
        }
      }
    },
    [
      maxFileSize,
      onFileProcessed,
      onError,
      processingStates,
      safeConfig.autoEmbedFiles,
      safeConfig.showEmbeddingProgress
    ]
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
