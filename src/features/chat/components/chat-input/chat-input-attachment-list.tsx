import { FilePreview } from "@/features/file-upload/components/file-preview"
import type { UseFileUploadReturn } from "@/features/file-upload/hooks/use-file-upload"

export interface ChatInputAttachmentListProps {
  processingStates: UseFileUploadReturn["processingStates"]
  onRemove: (file: File) => void
}

export const ChatInputAttachmentList = ({
  processingStates,
  onRemove
}: ChatInputAttachmentListProps) => {
  if (processingStates.length === 0) return null

  return (
    <div className="flex min-w-0 max-w-full flex-nowrap gap-1.5 overflow-x-auto p-1 pr-14 scrollbar-none">
      {processingStates.map((state) => (
        <FilePreview
          key={state.file.name}
          processingState={state}
          onRemove={() => onRemove(state.file)}
          compact
        />
      ))}
    </div>
  )
}
