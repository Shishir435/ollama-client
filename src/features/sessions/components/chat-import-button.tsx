import type React from "react"
import { useRef } from "react"
import { useTranslation } from "react-i18next"

import { TooltipActionButton } from "@/components/actions"
import { useImportChat } from "@/features/sessions/hooks/use-import-chat"
import { Upload } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

export const ChatImportButton = () => {
  const { t } = useTranslation()
  const { importChat } = useImportChat()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const handleClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    importChat(e.target.files)
    e.target.value = ""
  }

  return (
    <>
      <input
        type="file"
        ref={fileInputRef}
        accept=".json"
        className="hidden"
        multiple
        onChange={handleFileChange}
      />
      <TooltipActionButton
        variant="ghost"
        size="icon"
        className={cn(
          "size-7 shrink-0 rounded-control transition-all duration-200",
          "hover:bg-muted hover:text-foreground",
          "focus:bg-muted focus:text-foreground focus:opacity-100"
        )}
        onClick={handleClick}
        ariaLabel={t("sessions.import.aria_label")}
        tooltip={t("sessions.import.tooltip")}
        icon={<Upload className="icon-md" />}
      />
    </>
  )
}
