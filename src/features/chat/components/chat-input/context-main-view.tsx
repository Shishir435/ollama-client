import {
  Camera,
  Check as CheckIcon,
  ChevronRight,
  FileText,
  Lock
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { TooltipActionButton } from "@/components/actions"
import {
  ListRow,
  ListRowButton,
  ListRowDescription,
  ListRowTitle
} from "@/components/layout"
import type { ContextToggleAction } from "@/features/chat/hooks/use-context-settings"
import { FileUploadButton } from "@/features/file-upload/components/file-upload-button"

interface ContextMainViewProps {
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
              // Screenshot capture rides in this row rather than owning a
              // separate bordered one below it: both add an attachment to the
              // next message, so they belong to the same control, and the
              // standalone row was the widest label in the sheet.
              trailing={
                <>
                  {showScreenshot && onCaptureScreenshot && (
                    <TooltipActionButton
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="rounded-control text-muted-foreground hover:text-foreground"
                      disabled={disabled}
                      onClick={onCaptureScreenshot}
                      label={t("chat.input.screenshot")}
                      icon={<Camera className="icon-sm" />}
                    />
                  )}
                  <FileUploadButton
                    onFilesSelected={onFilesSelected}
                    disabled={disabled}
                    acceptImages={acceptImages}
                  />
                </>
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
          {/* Only reachable when the parent withheld the upload handler; with it
              present, capture lives in the row above. */}
          {!onFilesSelected && showScreenshot && onCaptureScreenshot && (
            <ListRowButton
              surface="outline"
              leading={<Camera className="icon-sm" />}
              disabled={disabled}
              onClick={onCaptureScreenshot}>
              <ListRowTitle>{t("chat.input.screenshot")}</ListRowTitle>
            </ListRowButton>
          )}
          {attachmentCount > 0 && (
            <ListRowButton
              surface="outline"
              leading={<FileText className="icon-sm" />}
              trailing={<ChevronRight className="icon-sm" />}
              trailingKind="control"
              onClick={onOpenAttachments}>
              <ListRowTitle>
                {t("chat.input.attachments", { count: attachmentCount })}
              </ListRowTitle>
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
      </div>
      {/* Its own group behind a rule. Sharing the toggle stack made it read as a
          switch that never turned on, when it opens another sheet — hence the
          chevron, which is the sheet's only navigation affordance. */}
      <div className="shrink-0 border-t border-border/40 pt-1.5">
        <ListRowButton
          className="text-muted-foreground"
          leading={<Lock className="icon-sm" />}
          trailing={<ChevronRight className="icon-sm" />}
          trailingKind="control"
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
