import type React from "react"
import { useRef } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { Paperclip } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

interface FileUploadButtonProps {
  onFilesSelected: (files: FileList) => void
  disabled?: boolean
  className?: string
}

export const FileUploadButton = ({
  onFilesSelected,
  disabled = false,
  className
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
    "application/javascript,application/json,application/xml,application/yaml"
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
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              "h-8 w-8 shrink-0 rounded-lg transition-all duration-200",
              "hover:bg-muted hover:text-foreground",
              "focus:bg-muted focus:text-foreground focus:opacity-100",
              disabled && "opacity-50 cursor-not-allowed",
              className
            )}
            onClick={handleClick}
            disabled={disabled}
            aria-label={t("file_upload.button.aria_label")}>
            <Paperclip className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("file_upload.button.tooltip")}</TooltipContent>
      </Tooltip>
    </>
  )
}
