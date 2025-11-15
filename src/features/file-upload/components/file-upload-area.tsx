import { useCallback, useEffect, useState } from "react"
import { FilePreview } from "@/features/file-upload/components/file-preview"
import { FileUploadButton } from "@/features/file-upload/components/file-upload-button"
import { useFileUpload } from "@/features/file-upload/hooks/use-file-upload"
import type {
  FileProcessingState,
  ProcessedFile
} from "@/lib/file-processors/types"

interface FileUploadAreaProps {
  onFilesProcessed: (files: ProcessedFile[]) => void
  disabled?: boolean
  compact?: boolean
}

export const FileUploadArea = ({
  onFilesProcessed,
  disabled = false,
  compact = false
}: FileUploadAreaProps) => {
  const [processedFiles, setProcessedFiles] = useState<ProcessedFile[]>([])

  const handleFileProcessed = useCallback(
    (file: ProcessedFile) => {
      setProcessedFiles((prev) => {
        const updated = [...prev, file]
        onFilesProcessed(updated)
        return updated
      })
    },
    [onFilesProcessed]
  )

  const { processFiles, processingStates, clearProcessingState } =
    useFileUpload({
      onFileProcessed: handleFileProcessed,
      onError: (error) => {
        console.error("File processing error:", error)
      }
    })

  const handleFilesSelected = useCallback(
    (files: FileList) => {
      processFiles(files)
    },
    [processFiles]
  )

  const handleRemoveFile = useCallback(
    (file: File) => {
      clearProcessingState(file)
      setProcessedFiles((prev) => {
        const updated = prev.filter((f) => f.metadata.fileName !== file.name)
        onFilesProcessed(updated)
        return updated
      })
    },
    [clearProcessingState, onFilesProcessed]
  )

  // Update processed files when processing states change
  useEffect(() => {
    const successful = processingStates
      .filter(
        (s): s is FileProcessingState & { result: ProcessedFile } =>
          s.status === "success" && s.result !== undefined
      )
      .map((s) => s.result)

    // Check if files have actually changed
    const currentFileNames = new Set(
      processedFiles.map((f) => f.metadata.fileName)
    )
    const newFileNames = new Set(successful.map((f) => f.metadata.fileName))

    const hasChanges =
      successful.length !== processedFiles.length ||
      successful.some((f) => !currentFileNames.has(f.metadata.fileName)) ||
      processedFiles.some((f) => !newFileNames.has(f.metadata.fileName))

    if (hasChanges) {
      setProcessedFiles(successful)
      onFilesProcessed(successful)
    }
  }, [processingStates, processedFiles, onFilesProcessed])

  const hasFiles = processingStates.length > 0
  const successCount = processingStates.filter(
    (s) => s.status === "success"
  ).length

  if (compact) {
    return (
      <FileUploadButton
        onFilesSelected={handleFilesSelected}
        disabled={disabled}
      />
    )
  }

  return (
    <div className="space-y-2">
      {hasFiles && (
        <div className="space-y-1">
          {processingStates.map((state) => (
            <FilePreview
              key={state.file.name}
              processingState={state}
              onRemove={() => handleRemoveFile(state.file)}
            />
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <FileUploadButton
          onFilesSelected={handleFilesSelected}
          disabled={disabled}
        />
        {hasFiles && successCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {successCount} file{successCount !== 1 ? "s" : ""} ready
          </span>
        )}
      </div>
    </div>
  )
}
