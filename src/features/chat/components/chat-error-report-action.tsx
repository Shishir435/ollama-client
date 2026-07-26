import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  type ErrorRecoveryAction,
  type ErrorRecoveryContext,
  resolveErrorRecoveryAction
} from "@/features/chat/lib/error-recovery-actions"
import { SETTINGS_REGISTRY } from "@/features/settings/settings-registry"
import { useToast } from "@/hooks/use-toast"
import { openExternalUrl, openOptionsInTab, runtime } from "@/lib/browser-api"
import {
  buildChatMessageErrorReportUrl,
  type SafeErrorChecks
} from "@/lib/error-report"
import { sanitizeProviderBaseUrl } from "@/lib/error-utils"
import { logger } from "@/lib/logger"
import { Bug, Check, Copy, Loader2 } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"
import type { DiagnosticsGetBundleResult } from "@/protocol/diagnostics-rpc"
import { extensionRpcClient } from "@/protocol/extension-client"
import { RpcMethod } from "@/protocol/rpc"
import type { ChatMessage } from "@/types"

// Compact chips: the sidepanel is ~400px wide, so the three actions only share
// a row at this sizing. `min-w-0` lets the label truncate rather than push a
// sibling out of the row.
const errorChipCls =
  "h-6 min-w-0 gap-1 rounded-chip border px-2 text-micro shadow-none hover:border-border/50"
const recoveryChipCls = cn(
  errorChipCls,
  "shrink-0 border-border/30 bg-muted/25 text-foreground hover:bg-muted/45"
)
const supportChipCls = cn(
  errorChipCls,
  "shrink border-border/30 bg-muted/25 text-foreground hover:bg-muted/45"
)

const settingsTabForFocusId = (focusId: string): string | undefined =>
  SETTINGS_REGISTRY.find((entry) => entry.id === focusId)?.tab

/**
 * Countdown until a cooled-down recovery action becomes usable. Anchored to the
 * message timestamp, not to mount, so remounting the bubble (the message list is
 * virtualized) cannot restart a provider's back-off window.
 */
const useRecoveryCooldown = (
  cooldownMs: number | undefined,
  timestamp: number | undefined
): number => {
  // Only reached for a message with no timestamp; persisted messages always
  // carry one, which is what keeps the window stable across remounts.
  const mountedAt = useRef(Date.now())
  const deadline = (timestamp ?? mountedAt.current) + (cooldownMs ?? 0)
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, deadline - Date.now())
  )

  useEffect(() => {
    if (!cooldownMs) {
      setRemaining(0)
      return
    }
    const tick = () => {
      const next = Math.max(0, deadline - Date.now())
      setRemaining(next)
      return next
    }
    if (tick() === 0) return
    const interval = setInterval(() => {
      if (tick() === 0) clearInterval(interval)
    }, 500)
    return () => clearInterval(interval)
  }, [cooldownMs, deadline])

  return cooldownMs ? remaining : 0
}

export const ChatErrorReportAction = ({
  msg,
  sessionId,
  onRetry
}: {
  msg: ChatMessage
  sessionId?: string
  onRetry?: () => void
}) => {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [preparing, setPreparing] = useState(false)
  const [diagnosticsPreparing, setDiagnosticsPreparing] = useState(true)
  const [copied, setCopied] = useState(false)
  const [recoveryBusy, setRecoveryBusy] = useState(false)
  const diagnosticsPromise = useRef<
    Promise<DiagnosticsGetBundleResult["bundle"] | undefined> | undefined
  >(undefined)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  )

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
    },
    []
  )

  const loadDiagnostics = useCallback(() => {
    diagnosticsPromise.current ??= extensionRpcClient
      .call(RpcMethod.DiagnosticsGetBundle, { sessionId })
      .then(({ bundle }) => bundle)
      .catch(() => undefined)
    return diagnosticsPromise.current
  }, [sessionId])

  useEffect(() => {
    let mounted = true
    void loadDiagnostics().finally(() => {
      if (mounted) setDiagnosticsPreparing(false)
    })
    return () => {
      mounted = false
    }
  }, [loadDiagnostics])

  /**
   * Read the enabled flag from provider config. A successful `listModels` used
   * to stand in for it, which is not the same claim: discovery is run with
   * `enabledOnly: false`, so it succeeds against a *disabled* provider and the
   * report then asserted "enabled: yes" while the diagnostics line right below
   * it read `disabled`.
   */
  const readProviderEnabled = async (
    providerId: string
  ): Promise<boolean | undefined> => {
    try {
      const { providers } = await extensionRpcClient.call(
        RpcMethod.ProvidersList,
        {}
      )
      return providers.find((provider) => provider.id === providerId)?.enabled
    } catch {
      return undefined
    }
  }

  const openIssue = async () => {
    setPreparing(true)
    try {
      const providerId = msg.error?.providerId
      const checks: SafeErrorChecks = {
        providerEnabled:
          msg.error?.code === "OLC-PROVIDER-DISABLED"
            ? false
            : providerId
              ? await readProviderEnabled(providerId)
              : undefined,
        baseUrlValid: msg.error?.baseUrl
          ? Boolean(sanitizeProviderBaseUrl(msg.error.baseUrl))
          : undefined
      }
      if (providerId && msg.error?.code !== "OLC-PROVIDER-DISABLED") {
        const startedAt = performance.now()
        try {
          const result = await extensionRpcClient.call(
            RpcMethod.ProvidersListModels,
            {
              providerId,
              enabledOnly: false
            }
          )
          checks.latencyMs = Math.max(0, performance.now() - startedAt)
          checks.providerReachable = result.failures.length === 0
          if (msg.error?.model) {
            checks.selectedModelFound = result.models.some(
              (model) =>
                model.name === msg.error?.model ||
                model.model === msg.error?.model
            )
          }
        } catch {
          // Kept on the failure path on purpose — an instant refusal and a
          // 30 s timeout are different bugs. The draft labels it as time to
          // failure so it cannot be misread as a successful round trip.
          checks.latencyMs = Math.max(0, performance.now() - startedAt)
          checks.providerReachable = false
        }
      }
      const bundle = await loadDiagnostics()
      openExternalUrl(buildChatMessageErrorReportUrl(msg, bundle, checks))
    } catch {
      openExternalUrl(buildChatMessageErrorReportUrl(msg))
    } finally {
      setPreparing(false)
    }
  }

  const recoveryContext: ErrorRecoveryContext = {
    error: msg.error ?? {},
    retry: onRetry,
    ageMs: msg.timestamp ? Math.max(0, Date.now() - msg.timestamp) : 0,
    openSettings: (focusId) => {
      // Tab comes from the settings registry, so moving a control between tabs
      // cannot silently break this deep link.
      const tab = settingsTabForFocusId(focusId)
      const url = runtime.getURL(
        `options.html${tab ? `?tab=${tab}&` : "?"}focus=${focusId}`
      )
      void openOptionsInTab(url)
    }
  }
  const recovery = resolveErrorRecoveryAction(recoveryContext)
  const cooldownRemainingMs = useRecoveryCooldown(
    recovery?.cooldownMs?.(recoveryContext),
    msg.timestamp
  )
  const cooldownSeconds = Math.ceil(cooldownRemainingMs / 1000)

  const runRecovery = async (action: ErrorRecoveryAction) => {
    setRecoveryBusy(true)
    try {
      await action.run(recoveryContext)
      if (action.retryAfterRun) recoveryContext.retry?.()
    } catch (error) {
      logger.error("Error recovery action failed", "ChatErrorReportAction", {
        actionId: action.id,
        error
      })
      toast({
        variant: "destructive",
        title: t("chat.errors.recovery_failed_title"),
        description: t("chat.errors.recovery_failed_description")
      })
    } finally {
      setRecoveryBusy(false)
    }
  }

  const copyDiagnostics = async () => {
    try {
      const bundle = await loadDiagnostics()
      if (!bundle) throw new Error("Diagnostic bundle unavailable")
      await navigator.clipboard.writeText(JSON.stringify(bundle, null, 2))
      setCopied(true)
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopied(false), 1500)
    } catch (error) {
      logger.error("Diagnostic report copy failed", "ChatErrorReportAction", {
        error
      })
      // Clipboard writes fail on an unfocused document, which otherwise looks
      // exactly like a dead button.
      toast({
        variant: "destructive",
        title: t("chat.errors.diagnostics_copy_failed_title"),
        description: t("chat.errors.diagnostics_copy_failed_description")
      })
    }
  }

  return (
    <div className="mt-1.5 w-full max-w-[90vw] px-2 sm:max-w-2xl">
      {/* One row by design: the registry resolves a single primary recovery
          chip, so this is at most three. flex-nowrap + truncate keeps long
          locales on one line instead of wrapping the report action below. */}
      <div className="flex w-full flex-nowrap items-center gap-1">
        {recovery && (
          <Button
            variant="ghost"
            size="sm"
            className={recoveryChipCls}
            disabled={recoveryBusy || cooldownSeconds > 0}
            onClick={() => void runRecovery(recovery)}>
            {recoveryBusy ? (
              <Loader2 className="icon-xs shrink-0 animate-spin" />
            ) : (
              <recovery.icon className="icon-xs shrink-0" />
            )}
            <span className="truncate">
              {cooldownSeconds > 0
                ? t("chat.errors.retry_in", { seconds: cooldownSeconds })
                : t(
                    recoveryBusy && recovery.busyLabelKey
                      ? recovery.busyLabelKey
                      : recovery.labelKey,
                    recovery.labelParams?.(recoveryContext)
                  )}
            </span>
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className={supportChipCls}
          disabled={diagnosticsPreparing}
          onClick={() => void copyDiagnostics()}>
          {diagnosticsPreparing ? (
            <Loader2 className="icon-xs shrink-0 animate-spin" />
          ) : copied ? (
            <Check className="icon-xs shrink-0 text-status-success" />
          ) : (
            <Copy className="icon-xs shrink-0" />
          )}
          <span className="truncate">
            {copied
              ? t("chat.errors.diagnostics_copied")
              : t("chat.errors.copy_diagnostics")}
          </span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            supportChipCls,
            "border-border/25 bg-transparent text-muted-foreground hover:bg-muted/35 hover:text-foreground"
          )}
          disabled={preparing}
          onClick={() => void openIssue()}>
          {preparing ? (
            <Loader2 className="icon-xs shrink-0 animate-spin" />
          ) : (
            <Bug className="icon-xs shrink-0" />
          )}
          <span className="truncate">
            {preparing
              ? t("chat.errors.preparing_issue")
              : t("chat.errors.open_issue")}
          </span>
        </Button>
      </div>

      {/* The copied state is otherwise only an icon swap, which announces
          nothing to a screen reader. */}
      <span aria-live="polite" className="sr-only">
        {copied ? t("chat.errors.diagnostics_copied") : ""}
      </span>

      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-micro text-muted-foreground/65">
        <span>{t("chat.errors.issue_draft_notice")}</span>
        {msg.error?.code && (
          <code className="select-all font-mono text-micro tracking-tight text-muted-foreground/60">
            {msg.error.code}
            {msg.error.incidentId ? ` · ${msg.error.incidentId}` : ""}
          </code>
        )}
      </div>
    </div>
  )
}
