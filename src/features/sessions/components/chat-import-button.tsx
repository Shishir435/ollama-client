import React, { useRef } from "react"

import { Upload } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useImportChat } from "@/features/sessions/hooks/use-import-chat"

export const ChatImportButton = () => {
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
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-8 w-8 shrink-0 rounded-lg transition-all duration-200",
              "hover:bg-muted hover:text-foreground",
              "focus:bg-muted focus:text-foreground focus:opacity-100"
            )}
            onClick={handleClick}
            aria-label="Import chat sessions">
            <Upload className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Import chat sessions</TooltipContent>
      </Tooltip>
    </>
  )
}
