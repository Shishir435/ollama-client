import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { TooltipActionButton } from "@/components/actions"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from "@/components/ui/sheet"
import { useContextSettings } from "@/features/chat/hooks/use-context-settings"
import { useContextTabOptions } from "@/features/chat/hooks/use-context-tab-options"
import { PermissionsSheet } from "@/features/permissions/components/permissions-sheet"
import type { FileProcessingState } from "@/lib/file-processors/types"
import { Layers } from "@/lib/lucide-icon"
import type { ImageAttachment } from "@/types"
import { CopyButton } from "../copy-button"
import { PreviewTextBlock } from "../preview-sheet"
import { AttachmentList } from "./attachment-list"
import { ContextMainView } from "./context-main-view"
import { ContextSubView } from "./context-sub-view"
import { buildContextSummary } from "./context-summary"
import { TabContextPanel } from "./tab-context-panel"

const EMPTY_PROCESSING_STATES: FileProcessingState[] = []
const EMPTY_IMAGES: ImageAttachment[] = []

export const ContextSettingsMenu = ({
  attachmentCount = 0,
  onFilesSelected,
  disabled = false,
  acceptImages = false,
  processingStates = EMPTY_PROCESSING_STATES,
  onRemoveFile,
  images = EMPTY_IMAGES,
  onRemoveImage,
  onCaptureScreenshot,
  showScreenshot = false
}: {
  attachmentCount?: number
  onFilesSelected?: (files: FileList) => void
  disabled?: boolean
  acceptImages?: boolean
  processingStates?: FileProcessingState[]
  onRemoveFile?: (file: File) => void
  images?: ImageAttachment[]
  onRemoveImage?: (imageId: string) => void
  onCaptureScreenshot?: () => void
  showScreenshot?: boolean
}) => {
  const { t } = useTranslation()
  const settings = useContextSettings()
  const tabs = useContextTabOptions({
    tabAccess: settings.tabAccess,
    excludedPatterns: settings.excludedPatterns,
    perSiteProfileList: settings.perSiteProfileList
  })

  const [open, setOpen] = useState(false)
  const [permsOpen, setPermsOpen] = useState(false)
  // In-sheet sub-views: a tab preview (previewTabId set) or the attachment list
  // ("attachments") replace the main panel instead of opening a second sheet, so
  // the user never loses their place in the Context sheet.
  const [view, setView] = useState<"main" | "attachments">("main")

  // The attachments view empties out when the user removes the last item — fall
  // back to the main panel instead of stranding them on a blank list.
  useEffect(() => {
    if (view === "attachments" && attachmentCount === 0) setView("main")
  }, [view, attachmentCount])

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) {
      setView("main")
      tabs.closePreview()
    }
  }

  const previewContent = tabs.previewTab?.html?.trim()
  const contextSummary = buildContextSummary(
    {
      tabAccess: settings.tabAccess,
      selectedTabCount: tabs.selectedTabIds.length,
      attachmentCount,
      useRAG: settings.useRAG,
      webSearchActive: settings.webSearchActive,
      showWebSearch: settings.showWebSearch
    },
    t
  )

  return (
    <>
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <TooltipActionButton
          trigger={
            <SheetTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 rounded-control text-muted-foreground hover:bg-muted/55 hover:text-foreground"
                  aria-label={t("tabs.context")}
                />
              }
            />
          }
          label={t("tabs.context")}
          icon={<Layers className="icon-sm" aria-hidden="true" />}
        />
        <SheetContent
          side="right"
          className="w-[min(28rem,calc(100vw-1rem))] gap-2 overflow-hidden p-2 sm:max-w-md"
          // Every text and leading glyph in this sheet sits on one content edge
          // 18px from the sheet's outer edge (8px sheet inset + 10px inner), and
          // every trailing glyph is optically 18px from the right edge. A
          // trailing hit-area therefore carries a smaller box inset than its
          // leading side: 18px minus the button's own padding.
          closeButtonClassName="top-2 right-3">
          <SheetHeader className="p-0 pl-2.5 pr-10">
            <SheetTitle className="flex items-center gap-2">
              <Layers className="icon-sm" />
              {t("tabs.context")}
            </SheetTitle>
            <SheetDescription className="sr-only">
              {t("tabs.inspector.description")}
            </SheetDescription>
          </SheetHeader>
          {tabs.previewTabId ? (
            <ContextSubView
              title={tabs.previewTab?.title || t("tabs.inspector.untitled")}
              onBack={tabs.closePreview}
              headerActions={
                <>
                  <span className="shrink-0 text-2xs text-muted-foreground">
                    {t("tabs.inspector.chars", {
                      count: previewContent?.length ?? 0
                    })}
                  </span>
                  {previewContent && <CopyButton text={previewContent} />}
                </>
              }>
              <ScrollArea className="min-h-0 flex-1 rounded-control border border-border/35 bg-background/35">
                <PreviewTextBlock
                  text={previewContent || ""}
                  emptyText={t("tabs.inspector.no_content")}
                />
              </ScrollArea>
            </ContextSubView>
          ) : view === "attachments" ? (
            <ContextSubView
              title={t("chat.input.attachments", { count: attachmentCount })}
              onBack={() => setView("main")}>
              <ScrollArea className="min-h-0 flex-1 overflow-x-hidden">
                <AttachmentList
                  processingStates={processingStates}
                  onRemove={onRemoveFile ?? (() => undefined)}
                  images={images}
                  onRemoveImage={onRemoveImage}
                />
              </ScrollArea>
            </ContextSubView>
          ) : (
            <ContextMainView
              contextSummary={contextSummary}
              toggleActions={settings.toggleActions}
              attachmentCount={attachmentCount}
              disabled={disabled}
              acceptImages={acceptImages}
              showScreenshot={showScreenshot}
              onFilesSelected={onFilesSelected}
              onCaptureScreenshot={onCaptureScreenshot}
              onOpenAttachments={() => setView("attachments")}
              onOpenPermissions={() => {
                setOpen(false)
                setPermsOpen(true)
              }}
              tabList={
                settings.tabAccess ? (
                  <TabContextPanel
                    filteredTabOptions={tabs.filteredTabOptions}
                    tabContents={tabs.tabContents}
                    getTabStatus={tabs.getTabStatus}
                    selectedTabIds={tabs.selectedTabIds}
                    tabSearch={tabs.tabSearch}
                    setTabSearch={tabs.setTabSearch}
                    refreshTabs={tabs.refreshTabs}
                    toggleTab={tabs.toggleTab}
                    openPreview={tabs.openPreview}
                  />
                ) : undefined
              }
            />
          )}
        </SheetContent>
      </Sheet>
      <PermissionsSheet open={permsOpen} onOpenChange={setPermsOpen} />
    </>
  )
}
