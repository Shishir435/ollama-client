import { MODEL_DISCOVERY_FAILURE } from "@ollama-client/contracts/provider-rpc"
import {
  AlertTriangle,
  Download,
  Loader2,
  RefreshCw,
  Server,
  Settings,
  XCircle
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover"
import { useEmbeddingStatus } from "@/features/model/hooks/use-embedding-status"
import { useProviderModels } from "@/features/model/hooks/use-provider-models"
import { cn } from "@/lib/class-names"
import { STATUS_STYLES } from "@/lib/ui-status"

type Tone = "danger" | "warning" | "neutral" | "success"

/** The tone the single header icon shows: the worst of what it summarizes. */
const worstTone = (tones: Tone[]): Tone =>
  (["danger", "warning", "neutral", "success"] as const).find((tone) =>
    tones.includes(tone)
  ) ?? "success"

/**
 * The header's one connection indicator. It used to be two icons, one for the
 * chat provider and one for the embedding model, that a glance could not tell
 * apart; this is one icon coloured by the worse of the two, and the popover
 * names each with its own fix.
 */
export const ConnectionStatusIndicator = () => {
  const { t } = useTranslation()
  const {
    status,
    refresh,
    error,
    unavailableProviders = []
  } = useProviderModels()
  const embeddings = useEmbeddingStatus()

  const providerTone: Tone =
    status === "error"
      ? "danger"
      : status === "empty"
        ? "warning"
        : status === "loading"
          ? "neutral"
          : "success"
  const embeddingTone: Tone = embeddings.loading
    ? "neutral"
    : embeddings.availability === "available"
      ? "success"
      : "warning"
  const tone = worstTone([providerTone, embeddingTone])
  const providerLabel = t(`model.provider_status.${status}`)
  const Icon =
    tone === "neutral"
      ? Loader2
      : tone === "danger"
        ? XCircle
        : tone === "warning"
          ? AlertTriangle
          : Server
  const toneText =
    tone === "neutral" ? STATUS_STYLES.neutral.text : STATUS_STYLES[tone].text

  return (
    <Popover>
      <TooltipActionButton
        label={t("chat.connection.label")}
        trigger={
          <PopoverTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("chat.connection.label")}
              />
            }
          />
        }
        icon={
          <Icon
            aria-hidden="true"
            className={cn(
              "icon-sm",
              toneText,
              tone === "neutral" && "animate-spin"
            )}
          />
        }
      />
      <PopoverContent align="end" sideOffset={8} className="w-72 gap-3">
        <section
          className="grid gap-1"
          aria-label={t("chat.connection.provider")}>
          <div className="flex items-center gap-2">
            <span className="font-medium">{t("chat.connection.provider")}</span>
            <span
              className={cn(
                "ml-auto min-w-0 truncate",
                STATUS_STYLES[
                  providerTone === "neutral" ? "neutral" : providerTone
                ].text
              )}>
              {providerLabel}
            </span>
            {status !== "loading" && (
              <TooltipActionButton
                variant="ghost"
                size="icon-xs"
                label={t("common.actions.retry")}
                onClick={() => refresh()}
                icon={<RefreshCw className="icon-xs" />}
              />
            )}
          </div>
          {status === "error" && error && (
            <p className={cn("text-xs", STATUS_STYLES.danger.text)}>{error}</p>
          )}
          {status !== "loading" &&
            unavailableProviders.map((failure) => (
              <p
                key={failure.providerId}
                className={cn("text-xs", STATUS_STYLES.danger.text)}>
                {t(
                  failure.code ===
                    MODEL_DISCOVERY_FAILURE.MODEL_LIST_UNSUPPORTED
                    ? "model.menu.providers_unavailable"
                    : "model.menu.providers_unreachable",
                  { names: failure.providerName ?? failure.providerId }
                )}
              </p>
            ))}
        </section>
        <section
          className="grid gap-1 border-t border-border pt-2"
          aria-label={t("chat.connection.embeddings")}>
          <div className="flex items-center gap-2">
            <span className="font-medium">
              {t("chat.connection.embeddings")}
            </span>
          </div>
          <p
            className={
              embeddingTone === "success"
                ? STATUS_STYLES.success.text
                : embeddings.color
            }>
            {embeddings.statusText}
          </p>
          <div className="flex flex-wrap gap-1">
            {embeddings.canDownload && (
              <Button
                size="sm"
                variant="secondary"
                onClick={embeddings.download}>
                <Download className="icon-xs" />
                {t("model.embedding_status.download_button")}
              </Button>
            )}
            {!embeddings.loading && embeddings.nativeMode === "external" && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void embeddings.checkModel()}>
                <RefreshCw className="icon-xs" />
                {t("common.actions.retry")}
              </Button>
            )}
            {embeddings.availability !== "available" && (
              <Button size="sm" variant="ghost" onClick={embeddings.openSetup}>
                <Settings className="icon-xs" />
                {t("onboarding.provider.open_setup")}
              </Button>
            )}
          </div>
        </section>
      </PopoverContent>
    </Popover>
  )
}
