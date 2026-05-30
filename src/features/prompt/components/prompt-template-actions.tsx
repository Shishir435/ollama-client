import { useRef } from "react"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { ConfirmActionDialog } from "@/components/settings"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { useConfirmAction } from "@/hooks/use-confirm-action"
import { logger } from "@/lib/logger"
import { Download, MoreHorizontal, RotateCcw, Upload } from "@/lib/lucide-icon"
import { safeJsonParse } from "@/lib/validation"

export interface PromptTemplateActionsProps {
  onExport: () => void
  onImport: (templates: unknown) => void
  onReset: () => void
}

export const PromptTemplateActions = ({
  onExport,
  onImport,
  onReset
}: PromptTemplateActionsProps) => {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const resetDialog = useConfirmAction()

  const handleResetConfirm = () => {
    resetDialog.closeDialog()
    onReset()
  }

  const handleImportFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      // TODO: after production soak (2026-Q3), switch to z.array(PromptTemplateSchema)
      // and let hook handle per-item skip. Remove the lenient unknown[] approach.
      const result = safeJsonParse(
        e.target?.result as string,
        z.array(z.unknown())
      )
      if (!result.success) {
        logger.error("Failed to import templates", "PromptTemplateActions", {
          error: result.error
        })
        alert("Failed to import templates. Please check the file format.")
        return
      }
      onImport(result.data)
    }
    reader.readAsText(file)

    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
          <MoreHorizontal className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onExport}>
            <Download className="mr-2 h-4 w-4" />
            {t("settings.prompts.export")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
            <Upload className="mr-2 h-4 w-4" />
            {t("settings.prompts.import")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault()
              resetDialog.openDialog()
            }}
            className="text-destructive focus:text-destructive">
            <RotateCcw className="mr-2 h-4 w-4" />
            {t("settings.prompts.reset")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmActionDialog
        open={resetDialog.open}
        onOpenChange={resetDialog.onOpenChange}
        title={t("settings.prompts.reset_dialog.title")}
        description={t("settings.prompts.reset_dialog.description")}
        confirmLabel={t("settings.prompts.reset_dialog.confirm")}
        cancelLabel={t("settings.prompts.reset_dialog.cancel")}
        destructive
        onConfirm={handleResetConfirm}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleImportFile}
        style={{ display: "none" }}
      />
    </>
  )
}
