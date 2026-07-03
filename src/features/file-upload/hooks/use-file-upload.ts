import { useStorage } from "@plasmohq/storage/hook"
import { useCallback, useState } from "react"
import { browser } from "@/lib/browser-api"
import {
  DEFAULT_FILE_UPLOAD_CONFIG,
  MESSAGE_KEYS,
  STORAGE_KEYS
} from "@/lib/constants"
import { getDisplayErrorMessage } from "@/lib/error-display"
import { processFile } from "@/lib/file-processors"
import type {
  FileProcessingState,
  ProcessedFile
} from "@/lib/file-processors/types"
import { processKnowledge } from "@/lib/knowledge"
import { markKnowledgeFileEmbedded } from "@/lib/knowledge/knowledge-sets"
import { logger } from "@/lib/logger"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type { FileUploadConfig } from "@/types"
import {
  ensureProcessedFileId,
  registerKnowledgeFile,
  validateFileForUpload
} from "./file-upload-pipeline"

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
          const result = await processFile(file)
          const fileId = ensureProcessedFileId(result)

          try {
            await registerKnowledgeFile(result, fileId)
          } catch (err) {
            logger.warn("Failed to register knowledge file", "useFileUpload", {
              error: err
            })
          }

          // One ingestion path: processKnowledge owns chunking + embedding for
          // files, using the same app chunker as live page context.
          if (safeConfig.autoEmbedFiles) {
            try {
              const processResult = await processKnowledge({
                fileId: result.metadata.fileId || file.name,
                fileName: result.metadata.fileName,
                content: result.text,
                pages: result.pages,
                contentType: file.type || "text/plain",
                onProgress: (progress) => {
                  if (!safeConfig.showEmbeddingProgress) return
                  const progressPercent =
                    progress.totalChunks > 0
                      ? Math.round(
                          (progress.processedChunks / progress.totalChunks) *
                            100
                        )
                      : 0
                  setProcessingStates((prev) => {
                    const next = new Map(prev)
                    next.set(file, {
                      file,
                      status: "processing",
                      progress: progressPercent,
                      result
                    })
                    return next
                  })
                }
              })

              if (!processResult.success) {
                throw new Error(
                  processResult.error || "Failed to embed processed file"
                )
              }

              logger.info(
                `Processed "${file.name}": ${processResult.chunkCount} chunks, ${processResult.vectorIds.length} embeddings`,
                "useFileUpload"
              )
              await markKnowledgeFileEmbedded(fileId)
              void browser.runtime
                .sendMessage({
                  type: MESSAGE_KEYS.APP.NOTIFY_JOB_COMPLETE,
                  payload: {
                    id: `embed-file-${fileId}`,
                    title: "File embedding done",
                    message: `${result.metadata.fileName || "File"} is ready for local knowledge search.`
                  }
                })
                .catch((error) => {
                  logger.debug?.(
                    "File embedding notification skipped",
                    "useFileUpload",
                    { error }
                  )
                })
            } catch (embeddingError) {
              const message = getDisplayErrorMessage(
                embeddingError,
                "Failed to embed processed file"
              )
              logger.error(`Failed to embed "${file.name}"`, "useFileUpload", {
                error: embeddingError
              })
              setProcessingStates((prev) => {
                const next = new Map(prev)
                next.set(file, {
                  file,
                  status: "error",
                  error: message,
                  result
                })
                return next
              })
              if (onError) {
                onError(
                  embeddingError instanceof Error
                    ? embeddingError
                    : new Error(message)
                )
              }
              continue
            }
          }

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
