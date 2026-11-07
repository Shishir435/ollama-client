import { Database, Settings, X } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import { Button } from "@/components/ui/button"
import { useSetting } from "@/hooks/use-setting"
import { openOptionsInTab, runtime } from "@/lib/browser-api"
import { SETTINGS } from "@/lib/storage/settings"

const DISMISSED_AT_KEY = "ollama-client:storage-full-dismissed-at"

/** The refusal time the user last dismissed; device-local, and absent when unreadable. */
const readDismissedAt = (): number => {
  try {
    return Number(window.localStorage.getItem(DISMISSED_AT_KEY)) || 0
  } catch {
    return 0
  }
}

/**
 * Chat indexing is silent, so a full vector store would otherwise look like
 * search quietly not finding recent chats. The store leaves a marker when it
 * refuses a write; this shows it until a write fits again or the limit is
 * raised past the one that refused. Dismissing hides it until the store
 * refuses another write, which stamps a newer marker.
 */
export const StorageFullNotice = () => {
  const { t } = useTranslation()
  const [full] = useSetting(SETTINGS.VECTOR_STORAGE_FULL)
  const [config] = useSetting(SETTINGS.EMBEDDING_CONFIG)
  const [dismissedAt, setDismissedAt] = useState(readDismissedAt)
  const limit = config?.maxStorageSize ?? 0
  if (!full || limit === 0 || limit > full.limitMB) return null
  if (full.at <= dismissedAt) return null

  const dismiss = () => {
    setDismissedAt(full.at)
    try {
      window.localStorage.setItem(DISMISSED_AT_KEY, String(full.at))
    } catch {
      // Storage can be blocked; the notice then stays hidden for this view only.
    }
  }

  const raise = () => {
    void openOptionsInTab(
      runtime.getURL("options.html?tab=knowledge&focus=max-storage-size")
    )
  }

  return (
    <output className="mx-2 block rounded-panel border border-status-warning/40 bg-tint-warning p-3">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-control bg-surface-sunken text-status-warning-text">
          <Database className="icon-sm" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            {t("chat.storage_full.title")}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("chat.storage_full.description", { max: limit })}
          </p>
          <div className="mt-2">
            <Button size="sm" variant="outline" onClick={raise}>
              <Settings className="icon-xs" />
              {t("chat.storage_full.action")}
            </Button>
          </div>
        </div>
        <TooltipActionButton
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={dismiss}
          label={t("chat.storage_full.dismiss")}
          icon={<X className="icon-xs" />}
        />
      </div>
    </output>
  )
}
