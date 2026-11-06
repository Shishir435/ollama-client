import { RpcMethod } from "@ollama-client/contracts/rpc"
import { ExternalLink, PackageOpen, RefreshCw, ServerOff } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { SetupGuideLink } from "@/components/setup-guide-link"
import { Button } from "@/components/ui/button"
import { CopyButton } from "@/features/chat/components/copy-button"
import { OllamaOriginsCommand } from "@/features/model/components/ollama-origins-command"
import { useProviderModels } from "@/features/model/hooks/use-provider-models"
import { openExternalUrl, openOptionsInTab, runtime } from "@/lib/browser-api"
import { cn } from "@/lib/class-names"
import { EXTERNAL_URLS } from "@/lib/constants/urls"
import { isAppError } from "@/lib/error-utils"
import { OLLAMA_CORS_MESSAGE_KEY } from "@/lib/onboarding/provider-connection"
import { extensionRpcClient } from "@/protocol/extension-client"

const OLLAMA_PULL_COMMAND = "ollama pull llama3.2"
/**
 * Runs the stored provider's connection test and returns the classified
 * failure, or null when it now succeeds or fails without a classification.
 */
const classifyStoredProvider = async (
  providerId: string
): Promise<ClassifiedFailure | null> => {
  try {
    await extensionRpcClient.call(RpcMethod.ProvidersTestConnection, {
      target: "stored",
      providerId
    })
    return null
  } catch (error) {
    if (!isAppError(error) || !error.messageKey) return null
    const provider = error.messageParams?.provider
    return {
      messageKey: error.messageKey,
      provider: typeof provider === "string" ? provider : ""
    }
  }
}

const UNAVAILABLE_MESSAGE_KEY = "onboarding.provider.errors.unavailable"

interface ClassifiedFailure {
  messageKey: string
  provider: string
}

/**
 * Why the panel can't chat yet, with the way out. Says nothing while
 * connecting or once a provider answers: the composer is the ready state.
 * Drawn like an onboarding step — a quiet card with a tinted glyph — because
 * a stopped local server is a setup step, not an alarm.
 */
export const ProviderStatusCard = () => {
  const {
    status,
    refresh,
    unavailableProviders = [],
    ollamaEnabled
  } = useProviderModels()
  const unreachableName = unavailableProviders[0]?.providerName
  const unreachableId = unavailableProviders[0]?.providerId
  const { t } = useTranslation()
  /**
   * A background catalog poll reports "loading" for its duration. The card
   * holds the last settled answer through it rather than blinking out every
   * poll, and the setup sheet below is mounted regardless, so a poll never
   * discards a half-edited provider form.
   */
  const [settled, setSettled] = useState(status)
  if (status !== "loading" && status !== settled) setSettled(status)
  const blocked = settled === "error" || settled === "empty"

  const unreachable = settled === "error"
  const [classified, setClassified] = useState<ClassifiedFailure | null>(null)
  /**
   * "Unreachable" covers a stopped server and one that refused this
   * extension's origin alike. The stored-provider connection test classifies
   * the failure, so a CORS block gets its fix instead of "start it".
   */
  useEffect(() => {
    if (!unreachable || !unreachableId) return
    let active = true
    void classifyStoredProvider(unreachableId).then((result) => {
      if (active) setClassified(result)
    })
    return () => {
      active = false
    }
  }, [unreachable, unreachableId])
  const specific =
    unreachable &&
    classified &&
    classified.messageKey !== UNAVAILABLE_MESSAGE_KEY
      ? classified
      : null
  const Icon = unreachable ? ServerOff : PackageOpen
  const title = unreachable
    ? t("welcome.status.connection_failed.title", {
        provider: unreachableName ?? t("welcome.status.provider_fallback")
      })
    : t("welcome.status.no_models.title")
  const message = specific
    ? t(specific.messageKey, {
        provider:
          specific.provider ||
          unreachableName ||
          t("welcome.status.provider_fallback")
      })
    : unreachable
      ? t("welcome.status.connection_failed.message")
      : t(
          ollamaEnabled
            ? "welcome.status.no_models.message"
            : "welcome.status.no_models.message_generic"
        )

  /**
   * Provider setup is the options page's providers section, not a copy of its
   * form in a sheet: the page has the room the full form needs and the
   * side panel does not.
   */
  const openProviderSetup = () => {
    void openOptionsInTab(
      runtime.getURL("options.html?tab=models&focus=provider-settings")
    )
  }
  /**
   * A refused connection is a stopped server or one that was never installed;
   * the download link covers the second without guessing which it is.
   */
  const showDownloadLink = unreachable && !specific && ollamaEnabled

  return (
    <>
      {blocked && (
        <output
          aria-atomic="true"
          aria-live="polite"
          className="flex w-full max-w-sm flex-col gap-4 rounded-panel border border-border bg-card p-4 text-card-foreground shadow-sm">
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-control",
                unreachable
                  ? "bg-tint-danger text-destructive"
                  : "bg-tint-warning text-foreground"
              )}>
              <Icon className="icon-md" />
            </div>
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-semibold">{title}</p>
              <p className="text-xs text-muted-foreground">{message}</p>
            </div>
          </div>
          {specific?.messageKey === OLLAMA_CORS_MESSAGE_KEY && (
            <OllamaOriginsCommand />
          )}
          {showDownloadLink && (
            <Button
              variant="link"
              className="h-auto self-start px-0 text-xs"
              onClick={() => openExternalUrl(EXTERNAL_URLS.OLLAMA_DOWNLOAD)}>
              <ExternalLink className="icon-xs" />
              {t("welcome.status.connection_failed.download")}
            </Button>
          )}
          {!unreachable && ollamaEnabled && (
            <div className="flex items-center gap-1 rounded-control bg-muted p-2 text-foreground">
              <code className="min-w-0 flex-1 break-all font-mono text-xs select-all">
                {OLLAMA_PULL_COMMAND}
              </code>
              <CopyButton text={OLLAMA_PULL_COMMAND} />
            </div>
          )}
          <div className="flex gap-2">
            <Button className="flex-1" onClick={openProviderSetup}>
              {t("onboarding.provider.open_setup")}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                refresh()
                if (unreachable && unreachableId) {
                  void classifyStoredProvider(unreachableId).then(setClassified)
                }
              }}>
              <RefreshCw className="icon-xs" />
              {t("common.actions.retry")}
            </Button>
          </div>
          <SetupGuideLink className="h-auto self-center px-0 text-xs" />
        </output>
      )}
    </>
  )
}
