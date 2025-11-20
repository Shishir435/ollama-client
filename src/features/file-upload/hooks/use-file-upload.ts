import { useCallback, useState } from "react"

import { FILE_UPLOAD } from "@/lib/constants"
import { isFileTypeSupported, processFile } from "@/lib/file-processors"
import type {
  FileProcessingState,
  ProcessedFile
} from "@/lib/file-processors/types"

export interface UseFileUploadOptions {
  onFileProcessed?: (file: ProcessedFile) => void
  onError?: (error: Error) => void
  maxFileSize?: number
}

export function useFileUpload(options: UseFileUploadOptions = {}) {
  const {
    onFileProcessed,
    onError,
    maxFileSize = FILE_UPLOAD.MAX_SIZE
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

          // Update state with success
          newStates.set(file, {
            file,
            status: "success",
            result
          })
          setProcessingStates(new Map(newStates))

          if (onFileProcessed) {
            onFileProcessed(result)
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error"
          newStates.set(file, {
            file,
            status: "error",
            error: errorMessage
          })
          setProcessingStates(new Map(newStates))

          if (onError) {
            onError(error instanceof Error ? error : new Error(errorMessage))
          }
        }
      }
    },
    [maxFileSize, onFileProcessed, onError, processingStates]
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
