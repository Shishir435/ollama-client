import { Camera, Check as CheckIcon, FileText, Lock } from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  ListRow,
  ListRowButton,
  ListRowDescription,
  ListRowTitle
} from "@/components/layout"
import type { ContextToggleAction } from "@/features/chat/hooks/use-context-settings"
import { FileUploadButton } from "@/features/file-upload/components/file-upload-button"

interface ContextMainViewProps {
  contextSummary: string
  toggleActions: ContextToggleAction[]
  attachmentCount: number
  disabled: boolean
  acceptImages: boolean
  showScreenshot: boolean
  onFilesSelected?: (files: FileList) => void
  onCaptureScreenshot?: () => void
  onOpenAttachments: () => void
  onOpenPermissions: () => void
  /** The tab list, mounted only while tab access is on. */
  tabList?: React.ReactNode
}

export const ContextMainView = ({
  contextSummary,
  toggleActions,
  attachmentCount,
  disabled,
  acceptImages,
  showScreenshot,
  onFilesSelected,
  onCaptureScreenshot,
  onOpenAttachments,
  onOpenPermissions,
  tabList
}: ContextMainViewProps) => {
  const { t } = useTranslation()
  const hasActions =
    Boolean(onFilesSelected) ||
    attachmentCount > 0 ||
    (showScreenshot && Boolean(onCaptureScreenshot))

  return (
    // The sheet itself does not scroll: the controls keep their natural height
    // here and the tab list below claims the remainder. This column only scrolls
    // when the controls alone outgrow the sheet (short window, every optional
    // row visible).
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
      <div className="shrink-0 rounded-control border border-border/40 bg-muted/25 px-2.5 py-1.5">
        <p className="text-micro font-medium uppercase text-muted-foreground">
          {t("chat.context.preview_title")}
        </p>
        <p className="mt-0.5 text-xs text-foreground">{contextSummary}</p>
      </div>
      {/* Single column: at a side panel's width a two-column row clipped labels
          like "Capture screenshot" mid-word. */}
      {hasActions && (
        <div className="grid shrink-0 gap-1.5">
          {onFilesSelected && (
            <ListRow
              surface="outline"
              trailingKind="control"
              description={
                <ListRowDescription>
                  {t(
                    acceptImages
                      ? "file_upload.button.formats_with_images"
                      : "file_upload.button.formats"
                  )}
                </ListRowDescription>
              }
              trailing={
                <FileUploadButton
                  onFilesSelected={onFilesSelected}
                  disabled={disabled}
                  acceptImages={acceptImages}
                />
              }>
              <ListRowTitle className="text-foreground">
                {t(
                  acceptImages
                    ? "file_upload.button.aria_label_with_images"
                    : "file_upload.button.aria_label"
                )}
              </ListRowTitle>
            </ListRow>
          )}
          {attachmentCount > 0 && (
            <ListRowButton
              surface="outline"
              leading={<FileText className="icon-sm" />}
              onClick={onOpenAttachments}>
              <ListRowTitle>
                {t("chat.input.attachments", { count: attachmentCount })}
              </ListRowTitle>
            </ListRowButton>
          )}
          {showScreenshot && onCaptureScreenshot && (
            <ListRowButton
              surface="outline"
              leading={<Camera className="icon-sm" />}
              disabled={disabled}
              onClick={onCaptureScreenshot}>
              <ListRowTitle>{t("chat.input.screenshot")}</ListRowTitle>
            </ListRowButton>
          )}
        </div>
      )}
      <div className="grid shrink-0 gap-0.5">
        {toggleActions.map((action) => {
          const Icon = action.icon
          return (
            <ListRowButton
              key={action.key}
              active={action.checked}
              leading={<Icon className="icon-sm" />}
              trailing={
                action.checked ? (
                  <CheckIcon className="icon-sm text-app-primary" />
                ) : undefined
              }
              onClick={action.onClick}>
              <ListRowTitle className="font-normal">
                {action.label}
              </ListRowTitle>
            </ListRowButton>
          )
        })}
        <ListRowButton
          className="text-muted-foreground"
          leading={<Lock className="icon-sm" />}
          onClick={onOpenPermissions}>
          <ListRowTitle className="font-normal">
            {t("settings.permissions.title")}
          </ListRowTitle>
        </ListRowButton>
      </div>
      {tabList}
    </div>
  )
}
