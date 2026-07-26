import { useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { openExternalUrl, openOptionsInTab, runtime } from "@/lib/browser-api"
import {
  buildChatMessageErrorReportUrl,
  type SafeErrorChecks
} from "@/lib/error-report"
import { sanitizeProviderBaseUrl } from "@/lib/error-utils"
import { Bug, Loader2, RefreshCcw, Settings } from "@/lib/lucide-icon"
import { extensionRpcClient } from "@/protocol/extension-client"
import { RpcMethod } from "@/protocol/rpc"
import type { ChatMessage } from "@/types"

const recoveryFocus = (
  action: NonNullable<ChatMessage["error"]>["recoveryAction"]
) => {
  if (action === "enable-provider") return "provider-enabled"
  if (action === "test-connection") return "provider-test-connection"
  if (action === "choose-model") return "provider-picker"
  if (action === "open-diagnostics") return "diagnostics-support"
  return undefined
}

export const ChatErrorReportAction = ({
  msg,
  onRetry
}: {
  msg: ChatMessage
  onRetry?: () => void
}) => {
  const { t } = useTranslation()
  const [preparing, setPreparing] = useState(false)
  const action = msg.error?.recoveryAction
  const focus = recoveryFocus(action)

  const openIssue = async () => {
    setPreparing(true)
    try {
      const diagnosticsPromise = extensionRpcClient
        .call(RpcMethod.DiagnosticsGetBundle, {})
        .then(({ bundle }) => bundle)
        .catch(() => undefined)
      const checks: SafeErrorChecks = {
        providerEnabled:
          msg.error?.code === "OLC-PROVIDER-DISABLED" ? false : undefined,
        baseUrlValid: msg.error?.baseUrl
          ? Boolean(sanitizeProviderBaseUrl(msg.error.baseUrl))
          : undefined
      }
      if (msg.error?.providerId && msg.error.code !== "OLC-PROVIDER-DISABLED") {
        const startedAt = performance.now()
        try {
          const result = await extensionRpcClient.call(
            RpcMethod.ProvidersListModels,
            {
              providerId: msg.error.providerId,
              enabledOnly: false
            }
          )
          checks.latencyMs = Math.max(0, performance.now() - startedAt)
          checks.providerReachable = result.failures.length === 0
          checks.providerEnabled = true
          if (msg.error.model) {
            checks.selectedModelFound = result.models.some(
              (model) =>
                model.name === msg.error?.model ||
                model.model === msg.error?.model
            )
          }
        } catch {
          checks.latencyMs = Math.max(0, performance.now() - startedAt)
          checks.providerReachable = false
        }
      }
      const bundle = await diagnosticsPromise
      openExternalUrl(buildChatMessageErrorReportUrl(msg, bundle, checks))
    } catch {
      openExternalUrl(buildChatMessageErrorReportUrl(msg))
    } finally {
      setPreparing(false)
    }
  }

  const openRecoverySettings = () => {
    const tab = action === "open-diagnostics" ? "help" : "models"
    const url = runtime.getURL(
      `options.html?tab=${tab}${focus ? `&focus=${focus}` : ""}`
    )
    void openOptionsInTab(url)
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
      {focus && (
        <Button variant="secondary" size="sm" onClick={openRecoverySettings}>
          <Settings className="icon-xs" />
          {action === "open-diagnostics"
            ? t("chat.errors.open_diagnostics")
            : t("settings.shortcuts.open_settings")}
        </Button>
      )}
      {(action === "retry" || action === "wait-retry") && onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <RefreshCcw className="icon-xs" />
          {t("common.actions.retry")}
        </Button>
      )}
      <Button
        variant="outline"
        size="sm"
        disabled={preparing}
        onClick={() => void openIssue()}>
        {preparing ? (
          <Loader2 className="icon-xs animate-spin" />
        ) : (
          <Bug className="icon-xs" />
        )}
        {preparing
          ? t("chat.errors.preparing_issue")
          : t("chat.errors.open_issue")}
      </Button>
      <span className="text-micro text-muted-foreground">
        {t("chat.errors.issue_draft_notice")}
      </span>
      {msg.error?.code && (
        <code className="select-all text-micro text-muted-foreground">
          {msg.error.code}
          {msg.error.incidentId ? ` · ${msg.error.incidentId}` : ""}
        </code>
      )}
    </div>
  )
}
