import type React from "react"
import { useRef } from "react"
import { useTranslation } from "react-i18next"

import { TooltipActionButton } from "@/components/actions"
import { SUPPORTED_IMAGE_MIME_TYPES } from "@/lib/constants"
import { Paperclip } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

export interface FileUploadButtonProps {
  onFilesSelected: (files: FileList) => void
  disabled?: boolean
  className?: string
  /** Also allow image files in the picker (vision-capable model selected). */
  acceptImages?: boolean
}

export const FileUploadButton = ({
  onFilesSelected,
  disabled = false,
  className,
  acceptImages = false
}: FileUploadButtonProps) => {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const handleClick = () => {
    if (!disabled) {
      fileInputRef.current?.click()
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0) {
      onFilesSelected(files)
    }
    // Reset input to allow selecting the same file again
    e.target.value = ""
  }

  const accept = [
    "text/*", // Text files
    "application/pdf,.pdf", // PDF
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx", // DOCX
    "text/csv,.csv", // CSV
    "text/tab-separated-values,.tsv", // TSV
    "text/html,.html,.htm", // HTML
    "application/javascript,application/json,application/xml,application/yaml",
    // Images for vision models (routed to the image pipeline by the composer).
    ...(acceptImages ? [SUPPORTED_IMAGE_MIME_TYPES.join(",")] : [])
  ].join(",")

  return (
    <>
      <input
        type="file"
        ref={fileInputRef}
        accept={accept}
        multiple
        className="hidden"
        onChange={handleFileChange}
        disabled={disabled}
      />
      <TooltipActionButton
        type="button"
        variant="ghost"
        size="icon"
        className={cn(
          "shrink-0 rounded-control text-muted-foreground transition-all duration-200",
          "hover:bg-muted hover:text-foreground",
          "focus:bg-muted focus:text-foreground focus:opacity-100",
          disabled && "opacity-50 cursor-not-allowed",
          className
        )}
        onClick={handleClick}
        disabled={disabled}
        ariaLabel={t(
          acceptImages
            ? "file_upload.button.aria_label_with_images"
            : "file_upload.button.aria_label"
        )}
        tooltip={t(
          acceptImages
            ? "file_upload.button.tooltip_with_images"
            : "file_upload.button.tooltip"
        )}
        icon={<Paperclip className="icon-lg" />}
      />
    </>
  )
}
