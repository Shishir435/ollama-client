import type { TFunction } from "i18next"
import { Code, FileDown, FileText } from "lucide-react"
import type { ActionMenuItemConfig } from "@/components/actions"

export interface ExportActionHandlers {
  onPdf: () => void
  onJson: () => void
  /** Whole-chat Markdown; omitted where the unit is a single message. */
  onMarkdown?: () => void
}

/**
 * Canonical export-format menu items shared by every "..." overflow menu
 * (chat message footer + session list row). Centralized so the format→icon
 * mapping and icon size stay identical across surfaces — distinct glyph per
 * format, all `icon-sm` to read inside the grid's `size-8` cells.
 */
export function buildExportActionItems(
  t: TFunction,
  handlers: ExportActionHandlers
): ActionMenuItemConfig[] {
  return [
    {
      key: "pdf",
      label: t("sessions.export.format_pdf"),
      icon: <FileDown className="icon-sm" />,
      onClick: handlers.onPdf
    },
    ...(handlers.onMarkdown
      ? [
          {
            key: "markdown",
            label: t("sessions.export.format_markdown"),
            icon: <FileText className="icon-sm" />,
            onClick: handlers.onMarkdown
          }
        ]
      : []),
    {
      key: "json",
      label: t("sessions.export.format_json"),
      icon: <Code className="icon-sm" />,
      onClick: handlers.onJson
    }
  ]
}
