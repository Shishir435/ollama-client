import { RpcMethod } from "@ollama-client/contracts/rpc"
import {
  type LucideIcon,
  Play,
  Power,
  RefreshCcw,
  Settings
} from "lucide-react"
import { extensionRpcClient } from "@/protocol/extension-client"
import type { ChatMessage } from "@/types"
import type { AppErrorRecoveryAction } from "@/types/errors"

export type ChatMessageError = NonNullable<ChatMessage["error"]>

/**
 * Registry of recovery actions offered on a failed chat message.
 *
 * The error bubble renders the first {@link MAX_RECOVERY_CHIPS} entries whose
 * `isAvailable` matches, so order is priority: an in-place fix beats sending
 * the user to the options page. Adding a recovery path means adding an entry
 * here — the component renders whatever the registry resolves and knows
 * nothing about individual error codes.
 */
export interface ErrorRecoveryContext {
  error: ChatMessageError
  /**
   * Re-run the failed turn. Absent when the message cannot be regenerated —
   * a turn that delegated a browser run, whose effects a second attempt would
   * repeat beside the first.
   */
  retry?: () => void
  /**
   * Ask the model to carry on from the partial answer it had. Present only on
   * the latest failed answer that kept some text: the follow-up appends a turn
   * after it, which anywhere earlier would land in the middle of a conversation.
   */
  continueTurn?: () => void
  /** Open the options page focused on a settings control. */
  openSettings: (focusId: string) => void
  /**
   * Age of the failed message in ms. `0` for a message with no timestamp, which
   * only happens for a turn that has not been persisted yet — i.e. a live one.
   */
  ageMs: number
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
  /**
   * Stop offering the action once the failure is older than this. Set it on an
   * action that silently changes configuration: scrolling back to a week-old
   * failure should not present a button that flips a provider setting. Actions
   * that only start a new, visible attempt (retry, continue) and navigation
   * leave it unset and stay available.
   */
  maxAgeMs?: number
}

/** The row has room for one fix and one follow-up beside its support chips. */
export const MAX_RECOVERY_CHIPS = 2

/**
 * How long a failure keeps its actionable recovery affordance. Long enough to
 * survive a coffee break with the panel open, short enough that a failure the
 * user scrolls back to is treated as history rather than as something still
 * happening.
 */
export const RECOVERY_ACTION_MAX_AGE_MS = 60 * 60 * 1000

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
    maxAgeMs: RECOVERY_ACTION_MAX_AGE_MS,
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
    /**
     * A model that must be chosen or installed first is fixed in settings
     * before another attempt can differ from this one.
     */
    id: "open-settings-first",
    labelKey: "settings.shortcuts.open_settings",
    icon: Settings,
    isAvailable: ({ error }) =>
      error.recoveryAction === "choose-model" &&
      Boolean(settingsFocusForRecovery(error.recoveryAction)),
    run: ({ error, openSettings }) => {
      const focusId = settingsFocusForRecovery(error.recoveryAction)
      if (focusId) openSettings(focusId)
    }
  },
  {
    /**
     * Any failed turn can be asked again — a 5xx, an unreachable server, a
     * dropped stream — so this does not read the classification: the cases it
     * would have excluded are the ones the user most wants a second try on.
     * The one exception is upstream of this registry: `retry` is withheld for a
     * turn whose effects a repeat would duplicate. A provider-supplied
     * back-off still holds the button.
     */
    id: "retry-turn",
    labelKey: "common.actions.retry",
    icon: RefreshCcw,
    isAvailable: ({ retry }) => Boolean(retry),
    cooldownMs: ({ error }) =>
      error.recoveryAction === "wait-retry" ? error.retryAfterMs : undefined,
    run: ({ retry }) => retry?.()
  },
  {
    id: "continue-turn",
    labelKey: "chat.errors.continue",
    icon: Play,
    isAvailable: ({ continueTurn }) => Boolean(continueTurn),
    run: ({ continueTurn }) => continueTurn?.()
  },
  {
    // No `maxAgeMs`: opening a focused setting is read-only and is still the
    // right suggestion for an old failure. It is also the graceful landing spot
    // when a stale in-place fix above drops out of the running.
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

/** Every action the registry offers for this failure, in priority order. */
export const resolveErrorRecoveryActions = (
  context: ErrorRecoveryContext
): ErrorRecoveryAction[] =>
  ERROR_RECOVERY_ACTIONS.filter(
    (action) =>
      (action.maxAgeMs === undefined || context.ageMs < action.maxAgeMs) &&
      action.isAvailable(context)
  ).slice(0, MAX_RECOVERY_CHIPS)

export const resolveErrorRecoveryAction = (
  context: ErrorRecoveryContext
): ErrorRecoveryAction | undefined => resolveErrorRecoveryActions(context)[0]
