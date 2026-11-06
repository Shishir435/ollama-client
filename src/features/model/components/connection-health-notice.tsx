import { Download, RotateCcw, Settings } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import type { ConnectionHealth } from "@/features/model/hooks/use-connection-health"
import { cn } from "@/lib/class-names"
import { STATUS_STYLES } from "@/lib/ui-status"

/**
 * The model picker's status line for the view it is showing, with the fix
 * beside it. Healthy, still-checking and unverifiable say nothing here — the
 * dots carry those — so the line only takes room when there is something to
 * act on. For chat it reports the selected model's own provider; other
 * providers' failures stay in the chat view's all-providers notice.
 */
export const ConnectionHealthNotice = ({
  view,
  health
}: {
  view: "chat" | "embeddings"
  health: ConnectionHealth
}) => {
  const { t } = useTranslation()
  const { embeddings } = health

  if (view === "chat") {
    const { providerTone, retryProvider } = health
    if (providerTone !== "danger" && providerTone !== "warning") return null
    return (
      <output className="flex items-center gap-1 border-b border-border px-3 py-1.5 text-xs">
        <span
          className={cn(
            "min-w-0 flex-1",
            STATUS_STYLES[providerTone === "danger" ? "danger" : "warning"].text
          )}>
          {health.providerLabel}
        </span>
        {retryProvider && (
          <Button size="xs" variant="ghost" onClick={retryProvider}>
            <RotateCcw className="icon-xs" />
            {t("common.actions.retry")}
          </Button>
        )}
      </output>
    )
  }

  if (health.embeddingTone !== "warning" && !embeddings.isDownloading)
    return null
  const rebuilding = health.rebuild === "building"
  return (
    <output className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-1.5 text-xs">
      <span
        className={cn(
          "min-w-0 flex-1",
          embeddings.isDownloading || rebuilding
            ? "text-muted-foreground"
            : STATUS_STYLES.warning.text
        )}>
        {health.embeddingText}
      </span>
      {health.rebuild === "failed" && (
        <Button
          size="xs"
          variant="secondary"
          onClick={embeddings.resumeRebuild}>
          <RotateCcw className="icon-xs" />
          {t("settings.embeddings.bundled.resume")}
        </Button>
      )}
      {!health.rebuild && embeddings.canDownload && (
        <Button size="xs" variant="secondary" onClick={embeddings.download}>
          <Download className="icon-xs" />
          {t("model.embedding_status.download_button")}
        </Button>
      )}
      {!health.rebuild &&
        !embeddings.loading &&
        embeddings.nativeMode === "external" && (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => void embeddings.checkModel()}>
            <RotateCcw className="icon-xs" />
            {t("common.actions.retry")}
          </Button>
        )}
      {!rebuilding &&
        !embeddings.loading &&
        (health.rebuild !== null ||
          embeddings.availability !== "available") && (
          <Button size="xs" variant="ghost" onClick={embeddings.openSetup}>
            <Settings className="icon-xs" />
            {t("onboarding.provider.open_setup")}
          </Button>
        )}
    </output>
  )
}
