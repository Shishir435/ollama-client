/**
 * Optional API permission helper (v0.11.0 groundwork — FEATURE_ROADMAP §5).
 *
 * A thin, typed wrapper over `browser.permissions.*` for the discrete API
 * permissions the 0.11.x roadmap may request at runtime. Building it once here
 * means E2 (bookmarks/history), E5 (notifications), E9 (downloads), and any future
 * optional permission share one consent/revoke path and one Permissions-tab surface.
 *
 * Scope rules (privacy stance, FEATURE_ROADMAP §0.4):
 *   - This covers OPTIONAL API permissions only. Host access (`<all_urls>`) is
 *     standing and retained — it is intentionally NOT requested/removed here.
 *   - `requestPermission` MUST be called from a user gesture (e.g. a click).
 *     Browsers reject `permissions.request` made outside a user activation.
 */

import { browser } from "@/lib/browser-api"

/** Discrete optional API permissions the roadmap gates behind explicit consent. */
export type OptionalApiPermission =
  | "bookmarks"
  | "history"
  | "notifications"
  | "downloads"
  | "tabGroups"

/** Is the optional permission currently granted? Never throws. */
export const hasPermission = async (
  perm: OptionalApiPermission
): Promise<boolean> => {
  try {
    return await browser.permissions.contains({ permissions: [perm] })
  } catch {
    return false
  }
}

/**
 * Request an optional permission. Returns whether it is granted afterward.
 * MUST run inside a user gesture or the browser rejects it. Never throws.
 */
export const requestPermission = async (
  perm: OptionalApiPermission
): Promise<boolean> => {
  try {
    return await browser.permissions.request({ permissions: [perm] })
  } catch {
    return false
  }
}

/** Revoke an optional permission. Returns whether removal succeeded. Never throws. */
export const removePermission = async (
  perm: OptionalApiPermission
): Promise<boolean> => {
  try {
    return await browser.permissions.remove({ permissions: [perm] })
  } catch {
    return false
  }
}
