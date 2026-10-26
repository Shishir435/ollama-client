import { Database, Settings } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { useSetting } from "@/hooks/use-setting"
import { openOptionsInTab, runtime } from "@/lib/browser-api"
import { SETTINGS } from "@/lib/storage/settings"

/**
 * Chat indexing is silent, so a full vector store would otherwise look like
 * search quietly not finding recent chats. The store leaves a marker when it
 * refuses a write; this shows it until a write fits again or the limit is
 * raised past the one that refused.
 */
export const StorageFullNotice = () => {
  const { t } = useTranslation()
  const [full] = useSetting(SETTINGS.VECTOR_STORAGE_FULL)
  const [config] = useSetting(SETTINGS.EMBEDDING_CONFIG)
  const limit = config?.maxStorageSize ?? 0
  if (!full || limit === 0 || limit > full.limitMB) return null

  const raise = () => {
    void openOptionsInTab(
      runtime.getURL("options.html?tab=knowledge&focus=max-storage-size")
    )
  }

  return (
    <div
      aria-live="polite"
      className="mx-2 rounded-panel border border-status-warning/40 bg-tint-warning p-3">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-control bg-surface-sunken text-status-warning">
          <Database className="icon-sm" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            {t("chat.storage_full.title")}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("chat.storage_full.description", { max: full.limitMB })}
          </p>
          <div className="mt-2">
            <Button size="sm" variant="outline" onClick={raise}>
              <Settings className="icon-xs" />
              {t("chat.storage_full.action")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
