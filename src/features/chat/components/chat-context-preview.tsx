import { FileText, Quote } from "lucide-react"
import { useTranslation } from "react-i18next"

import { ContextPreview } from "@/components/data-display"
import { MiniBadge } from "@/components/ui/mini-badge"
import type { UseFileUploadReturn } from "@/features/file-upload/hooks/use-file-upload"
import {
  getFileContextPreview,
  getQuotedSelectionPreview
} from "../lib/context-preview-summary"

interface ChatContextPreviewProps {
  input: string
  processingStates: UseFileUploadReturn["processingStates"]
}

const formatChars = (count: number) => count.toLocaleString()

export const ChatContextPreview = ({
  input,
  processingStates
}: ChatContextPreviewProps) => {
  const { t } = useTranslation()
  const selection = getQuotedSelectionPreview(input)
  const fileContext = getFileContextPreview(processingStates)

  const hasFileContext = fileContext.totalCount > 0

  if (!selection && !hasFileContext) return null

  const items = [
    selection && {
      key: "selection",
      icon: Quote,
      title: t("chat.context_preview.selection"),
      body: selection.text,
      meta: t("chat.context_preview.chars", {
        count: formatChars(selection.charCount)
      })
    },
    hasFileContext && {
      key: "files",
      icon: FileText,
      title: t("chat.context_preview.files"),
      body: t("chat.context_preview.files_ready", {
        ready: fileContext.successCount,
        total: fileContext.totalCount,
        chars: formatChars(fileContext.charCount)
      }),
      meta:
        fileContext.processingCount > 0 || fileContext.errorCount > 0
          ? t("chat.context_preview.files_status", {
              processing: fileContext.processingCount,
              errors: fileContext.errorCount
            })
          : undefined
    }
  ].filter(Boolean)

  return (
    <div className="mb-2 grid gap-2">
      {items.map((item) => {
        const Icon = item.icon
        return (
          <ContextPreview
            key={item.key}
            className="bg-muted/20"
            title={
              <span className="flex min-w-0 items-center gap-1.5">
                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{item.title}</span>
              </span>
            }
            actions={item.meta ? <MiniBadge text={item.meta} /> : null}
            content={item.body}
          />
        )
      })}
    </div>
  )
}
