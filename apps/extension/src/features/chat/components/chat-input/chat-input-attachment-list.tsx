import { FilePreview } from "@/features/file-upload/components/file-preview"
import type { UseFileUploadReturn } from "@/features/file-upload/hooks/use-file-upload"

interface ChatInputAttachmentListProps {
  processingStates: UseFileUploadReturn["processingStates"]
  onRemove: (file: File) => void
}

export const ChatInputAttachmentList = ({
  processingStates,
  onRemove
}: ChatInputAttachmentListProps) => {
  if (processingStates.length === 0) return null

  return (
    <div className="mb-2 space-y-1">
      {processingStates.map((state) => (
        <FilePreview
          key={state.file.name}
          processingState={state}
          onRemove={() => onRemove(state.file)}
        />
      ))}
    </div>
  )
}
