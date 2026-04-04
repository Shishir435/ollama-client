import { FileIcon, FileText, Loader2 } from "lucide-react"
import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog"
import { getAllDocuments } from "@/lib/embeddings/vector-store"
import type { FileAttachment } from "@/types"

interface FileAttachmentDisplayProps {
  attachments: FileAttachment[]
}

function getFileIcon(fileType: string) {
  if (fileType === "application/pdf" || fileType.includes("document")) {
    return <FileText className="h-3 w-3" />
  }
  return <FileIcon className="h-3 w-3" />
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface FileViewerDialogProps {
  file: FileAttachment
}

function FileViewerDialog({ file }: FileViewerDialogProps) {
  const [open, setOpen] = useState(false)
  const [fullText, setFullText] = useState<string>("")
  const [isLoading, setIsLoading] = useState(false)

  // Fetch full text from vector store when dialog opens
  useEffect(() => {
    if (!open || !file.fileId) return

    async function fetchFullText() {
      setIsLoading(true)
      try {
        // Try to get full text from vector store
        const result = await getAllDocuments({
          fileId: file.fileId,
          type: "file"
        })

        if (result.documents.length > 0) {
          // Combine all chunks to get full text
          const combined = result.documents
            .map((doc) => doc.content)
            .join("\n\n")
          setFullText(combined)
        } else {
          // Fallback to preview if no documents found
          setFullText(file.textPreview || "No content available")
        }
      } catch (error) {
        console.error("Failed to fetch file content:", error)
        setFullText(
          file.textPreview || "Error loading content. Please try again."
        )
      } finally {
        setIsLoading(false)
      }
    }

    // Use preview initially, then fetch full content
    setFullText(file.textPreview || "")
    fetchFullText()
  }, [open, file.fileId, file.textPreview])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Badge
          variant="secondary"
          className="cursor-pointer hover:bg-secondary/80 transition-colors gap-1.5 pr-1">
          {getFileIcon(file.fileType)}
          <span className="max-w-[120px] truncate">{file.fileName}</span>
          <span className="text-[10px] text-muted-foreground">
            {formatFileSize(file.fileSize)}
          </span>
        </Badge>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {getFileIcon(file.fileType)}
            {file.fileName}
          </DialogTitle>
          <DialogDescription>
            {file.fileType} • {formatFileSize(file.fileSize)}
            {file.processedAt && (
              <> • Processed {new Date(file.processedAt).toLocaleString()}</>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 max-h-[60vh] overflow-y-auto">
          <div className="relative">
            {isLoading ? (
              <div className="flex items-center justify-center p-8 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                <span className="text-sm">Loading full content...</span>
              </div>
            ) : (
              <>
                <pre className="text-xs bg-muted rounded-lg p-4 whitespace-pre-wrap wrap-break-word font-mono">
                  {fullText || "No text content available"}
                </pre>
                {fullText && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="absolute top-2 right-2"
                    onClick={() => {
                      navigator.clipboard.writeText(fullText)
                    }}>
                    Copy Text
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function FileAttachmentDisplay({
  attachments
}: FileAttachmentDisplayProps) {
  if (!attachments || attachments.length === 0) {
    return null
  }

  return (
    <div className="flex flex-wrap gap-2 mb-2">
      {attachments.map((file, index) => (
        <FileViewerDialog key={file.fileId || index} file={file} />
      ))}
    </div>
  )
}
