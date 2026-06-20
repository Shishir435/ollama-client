import { browser } from "@/lib/browser-api"
import { logger } from "@/lib/logger"
import { hasPermission } from "@/lib/permissions"

interface NotifyOptions {
  /** Stable id to coalesce/replace a prior notification; defaults to unique. */
  id?: string
  title: string
  message: string
}

export interface NotifyResult {
  sent: boolean
  reason?: "permission-not-granted" | "api-unavailable" | "create-failed"
  error?: string
}

type NotificationsApi = {
  create: (id: string, options: Record<string, unknown>) => Promise<string>
}

type ChromeNotificationsApi = {
  create: (
    id: string,
    options: chrome.notifications.NotificationOptions,
    callback?: (id: string) => void
  ) => void
}

/**
 * Fire a desktop notification for a finished background job (E5 / 0.11.6).
 *
 * Gated by the optional `notifications` permission — the user opts in by granting
 * it in the Permissions panel; until then this is a silent no-op. Never throws,
 * so a notification failure can't break the job that triggered it.
 */
export const notifyJobComplete = async ({
  id,
  title,
  message
}: NotifyOptions): Promise<NotifyResult> => {
  try {
    if (!(await hasPermission("notifications"))) {
      return { sent: false, reason: "permission-not-granted" }
    }

    const options = {
      type: "basic",
      iconUrl: browser.runtime.getURL("assets/icon.png"),
      title,
      message
    } as const
    const notificationId = id ?? `job-${Date.now()}`

    const promiseNotifications = (
      browser as unknown as { notifications?: NotificationsApi }
    ).notifications
    if (promiseNotifications?.create) {
      await promiseNotifications.create(notificationId, options)
      return { sent: true }
    }

    const callbackNotifications = (
      globalThis.chrome as unknown as
        | {
            notifications?: ChromeNotificationsApi
            runtime?: { lastError?: { message?: string } }
          }
        | undefined
    )?.notifications
    if (!callbackNotifications?.create) {
      return { sent: false, reason: "api-unavailable" }
    }

    await new Promise<void>((resolve, reject) => {
      callbackNotifications.create(notificationId, options, () => {
        const lastError = globalThis.chrome?.runtime?.lastError
        if (lastError) reject(new Error(lastError.message))
        else resolve()
      })
    })
    return { sent: true }
  } catch (error) {
    logger.debug("Notification skipped", "notify", { error })
    return {
      sent: false,
      reason: "create-failed",
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
