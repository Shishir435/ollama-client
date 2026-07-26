import type { LucideIcon } from "@/lib/lucide-icon"
import { Power, RefreshCcw, Settings } from "@/lib/lucide-icon"
import { extensionRpcClient } from "@/protocol/extension-client"
import { RpcMethod } from "@/protocol/rpc"
import type { ChatMessage } from "@/types"
import type { AppErrorRecoveryAction } from "@/types/errors"

export type ChatMessageError = NonNullable<ChatMessage["error"]>

/**
 * Registry of primary recovery actions offered on a failed chat message.
 *
 * The error bubble renders the FIRST entry whose `isAvailable` matches, so
 * order is priority: an in-place fix beats sending the user to the options
 * page. Adding a recovery path means adding an entry here — the component
 * renders whatever the registry resolves and knows nothing about individual
 * error codes.
 */
export interface ErrorRecoveryContext {
  error: ChatMessageError
  /** Re-run the failed turn. Absent when the message cannot be regenerated. */
  retry?: () => void
  /** Open the options page focused on a settings control. */
  openSettings: (focusId: string) => void
}

export interface ErrorRecoveryAction {
  id: string
  labelKey: string
  /** Shown while an async `run` is in flight. Falls back to `labelKey`. */
  busyLabelKey?: string
  icon: LucideIcon
  /** Interpolation values for `labelKey`. */
  labelParams?: (context: ErrorRecoveryContext) => Record<string, string>
  isAvailable: (context: ErrorRecoveryContext) => boolean
  run: (context: ErrorRecoveryContext) => void | Promise<void>
  /**
   * How long the action stays unavailable after the error, in ms. Used for
   * provider-supplied back-off (`Retry-After`): offering an instant Retry
   * against a rate limit just burns another 429.
   */
  cooldownMs?: (context: ErrorRecoveryContext) => number | undefined
  /**
   * Re-run the failed turn once `run` resolves. For in-place fixes, where the
   * only reason the turn failed is the thing `run` just repaired.
   */
  retryAfterRun?: boolean
}

/**
 * Settings control to focus when a recovery action can only be completed on the
 * options page. Every value must resolve to a mounted `data-settings-focus-id`
 * (see `settings-registry.ts`).
 */
const SETTINGS_FOCUS_BY_ACTION: Partial<
  Record<AppErrorRecoveryAction, string>
> = {
  "enable-provider": "provider-enabled",
  "test-connection": "provider-test-connection",
  "choose-model": "provider-picker"
}

export const settingsFocusForRecovery = (
  action?: AppErrorRecoveryAction
): string | undefined => (action ? SETTINGS_FOCUS_BY_ACTION[action] : undefined)

export const ERROR_RECOVERY_ACTIONS: readonly ErrorRecoveryAction[] = [
  {
    id: "enable-provider-inline",
    labelKey: "chat.errors.enable_provider",
    busyLabelKey: "chat.errors.enabling_provider",
    icon: Power,
    retryAfterRun: true,
    labelParams: ({ error }) => ({
      provider: error.providerName || error.providerId || ""
    }),
    // Needs a provider id to target; without one the settings fallback below
    // still gets the user to the toggle.
    isAvailable: ({ error }) =>
      error.recoveryAction === "enable-provider" && Boolean(error.providerId),
    run: async ({ error }) => {
      await extensionRpcClient.call(RpcMethod.ProvidersSetEnabled, {
        providerId: String(error.providerId),
        enabled: true
      })
    }
  },
  {
    id: "retry-turn",
    labelKey: "common.actions.retry",
    icon: RefreshCcw,
    isAvailable: ({ error, retry }) =>
      Boolean(retry) &&
      (error.recoveryAction === "retry" ||
        error.recoveryAction === "wait-retry"),
    cooldownMs: ({ error }) =>
      error.recoveryAction === "wait-retry" ? error.retryAfterMs : undefined,
    run: ({ retry }) => retry?.()
  },
  {
    id: "open-settings",
    labelKey: "settings.shortcuts.open_settings",
    icon: Settings,
    isAvailable: ({ error }) =>
      Boolean(settingsFocusForRecovery(error.recoveryAction)),
    run: ({ error, openSettings }) => {
      const focusId = settingsFocusForRecovery(error.recoveryAction)
      if (focusId) openSettings(focusId)
    }
  }
]

export const resolveErrorRecoveryAction = (
  context: ErrorRecoveryContext
): ErrorRecoveryAction | undefined =>
  ERROR_RECOVERY_ACTIONS.find((action) => action.isAvailable(context))
