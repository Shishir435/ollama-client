import { useStorage } from "@plasmohq/storage/hook"
import { useCallback, useState } from "react"
import { browser } from "@/lib/browser-api"
import {
  DEFAULT_EMBEDDING_CONFIG,
  DEFAULT_FILE_UPLOAD_CONFIG,
  MESSAGE_KEYS,
  STORAGE_KEYS
} from "@/lib/constants"
import { chunkTextAsync } from "@/lib/embeddings/chunker"
import { isFileTypeSupported, processFile } from "@/lib/file-processors"
import type {
  FileProcessingState,
  ProcessedFile
} from "@/lib/file-processors/types"
import { processKnowledge } from "@/lib/knowledge"
import { logger } from "@/lib/logger"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type {
  EmbeddingConfig,
  EmbeddingStatusMessage,
  FileUploadConfig
} from "@/types"

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

  const [embeddingConfig] = useStorage<EmbeddingConfig>(
    {
      key: STORAGE_KEYS.EMBEDDINGS.CONFIG,
      instance: plasmoGlobalStorage
    },
    DEFAULT_EMBEDDING_CONFIG
  )

  const { onFileProcessed, onError, maxFileSize = config.maxFileSize } = options

  const [processingStates, setProcessingStates] = useState<
    Map<File, FileProcessingState>
  >(new Map())

  const processFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files)
      const newStates = new Map(processingStates)

      // Initialize processing states
      for (const file of fileArray) {
        // Check if file type is supported
        if (!isFileTypeSupported(file)) {
          const error = new Error(
            `Unsupported file type: "${file.name}". Supported formats: Text files (.txt, .md, .js, .ts, etc.), PDF (.pdf), and DOCX (.docx).`
          )
          newStates.set(file, {
            file,
            status: "error",
            error: error.message
          })
          if (onError) onError(error)
          continue
        }

        // Check file size
        if (file.size > maxFileSize) {
          const error = new Error(
            `File "${file.name}" exceeds maximum size of ${(maxFileSize / 1024 / 1024).toFixed(0)}MB`
          )
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

          // Generate embeddings if enabled
          if (config.autoEmbedFiles && embeddingConfig) {
            try {
              // Check if using new knowledge processor (enhanced text splitters)
              const useNewProcessor =
                embeddingConfig.useEnhancedChunking || false

              if (useNewProcessor) {
                // Use new knowledge processor with enhanced text splitters
                logger.info(
                  `Processing file "${file.name}" with enhanced knowledge system`,
                  "useFileUpload"
                )

                const processResult = await processKnowledge({
                  fileId: result.metadata.fileId || file.name,
                  fileName: result.metadata.fileName,
                  content: result.text,
                  contentType: file.type || "text/plain",
                  onProgress: (progress) => {
                    if (
                      config.showEmbeddingProgress &&
                      progress.status === "processing"
                    ) {
                      const progressPercent =
                        progress.totalChunks > 0
                          ? Math.round(
                              (progress.processedChunks /
                                progress.totalChunks) *
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
                  }
                })

                if (processResult.success) {
                  logger.info(
                    `Successfully processed "${file.name}": ${processResult.chunkCount} chunks, ${processResult.vectorIds.length} embeddings`,
                    "useFileUpload"
                  )
                } else {
                  logger.error(
                    `Failed to process "${file.name}"`,
                    "useFileUpload",
                    { error: processResult.error }
                  )
                }

                // Mark as complete
                if (config.showEmbeddingProgress) {
                  setProcessingStates((prev) => {
                    const next = new Map(prev)
                    next.set(file, {
                      file,
                      status: processResult.success ? "success" : "error",
                      progress: 100,
                      error: processResult.error,
                      result
                    })
                    return next
                  })
                }

                // Skip old chunking system
                continue
              }

              // Use old chunking system (backward compatibility)
              const chunks = await chunkTextAsync(result.text, {
                chunkSize: embeddingConfig.chunkSize,
                chunkOverlap: embeddingConfig.chunkOverlap,
                strategy: embeddingConfig.chunkingStrategy
              })

              logger.info(
                `Chunked file "${file.name}" into ${chunks.length} chunks (embedding queued in background)`,
                "useFileUpload"
              )

              // Mark status as queued so UI doesn't block while background processes embeddings
              if (config.showEmbeddingProgress) {
                setProcessingStates((prev) => {
                  const next = new Map(prev)
                  next.set(file, {
                    file,
                    status: "processing",
                    progress: 0,
                    result
                  })
                  return next
                })
              }

              // Stream chunks to background via a dedicated port to avoid sending one large message
              const port = browser.runtime.connect({
                name: MESSAGE_KEYS.OLLAMA.EMBED_FILE_CHUNKS
              })

              // Send init metadata
              port.postMessage({
                type: "init",
                payload: {
                  metadata: {
                    fileId: result.metadata.fileId || file.name,
                    title: result.metadata.fileName,
                    timestamp: Date.now()
                  }
                }
              })

              // Listen for progress updates from background
              port.onMessage.addListener((msg: unknown) => {
                try {
                  const m = msg as EmbeddingStatusMessage
                  if (m?.status === "progress") {
                    const processed = m.processed || 0
                    const total = m.total || 0
                    const progress =
                      total > 0 ? Math.round((processed / total) * 100) : 0
                    if (config.showEmbeddingProgress) {
                      setProcessingStates((prev) => {
                        const next = new Map(prev)
                        next.set(file, {
                          file,
                          status: "processing",
                          progress,
                          result
                        })
                        return next
                      })
                    }
                  } else if (m?.status === "done") {
                    // Embedding complete
                    if (config.showEmbeddingProgress) {
                      setProcessingStates((prev) => {
                        const next = new Map(prev)
                        next.set(file, {
                          file,
                          status: "success",
                          progress: 100,
                          result
                        })
                        return next
                      })
                    }
                    try {
                      port.postMessage({ type: "done" })
                    } catch (_) {}
                    try {
                      port.disconnect()
                    } catch (_) {}
                  } else if (m?.status === "error") {
                    logger.warn("Background embedding error", "useFileUpload", {
                      error: m?.message
                    })
                    if (config.showEmbeddingProgress) {
                      setProcessingStates((prev) => {
                        const next = new Map(prev)
                        next.set(file, {
                          file,
                          status: "error",
                          error: m?.message || "Embedding error",
                          result
                        })
                        return next
                      })
                    }
                    try {
                      port.disconnect()
                    } catch (_) {}
                  }
                } catch (e) {
                  logger.warn("Error handling port message", "useFileUpload", {
                    error: e
                  })
                }
              })

              // Stream batches to background to avoid sending a huge single message
              const batchSize = config.embeddingBatchSize || 3
              for (let i = 0; i < chunks.length; i += batchSize) {
                const batch = chunks
                  .slice(i, i + batchSize)
                  .map((c) => ({ index: c.index, text: c.text }))
                try {
                  port.postMessage({
                    type: "batch",
                    payload: { chunks: batch }
                  })
                  // Yield to event loop to keep UI responsive during heavy sending
                  await new Promise((resolve) => setTimeout(resolve, 0))
                } catch (e) {
                  logger.warn(
                    "Failed to post batch to embed port",
                    "useFileUpload",
                    { error: e }
                  )
                  try {
                    port.disconnect()
                  } catch (_) {}
                  break
                }
              }

              // Signal end of stream
              try {
                port.postMessage({ type: "done" })
              } catch (e) {
                logger.warn("Failed to send done signal", "useFileUpload", {
                  error: e
                })
              }
            } catch (embeddingError) {
              logger.error(
                `Failed to queue embeddings for "${file.name}"`,
                "useFileUpload",
                { error: embeddingError }
              )
            }
          }

          // Update state with success
          setProcessingStates((prev) => {
            const next = new Map(prev)
            next.set(file, {
              file,
              status: "success",
              result
            })
            return next
          })

          if (onFileProcessed) {
            onFileProcessed(result)
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error"
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
      config,
      embeddingConfig
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
