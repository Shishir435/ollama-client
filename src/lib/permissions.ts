/**
 * Optional API permission helper.
 *
 * A thin, typed wrapper over `browser.permissions.*` for the discrete API
 * optional permissions share one consent/revoke path and one Permissions-tab
 * surface.
 *
 * Scope rules:
 *   - This covers OPTIONAL API permissions only. Host access (`<all_urls>`) is
 *     standing and retained — it is intentionally NOT requested/removed here.
 *   - `requestPermission` MUST be called from a user gesture (e.g. a click).
 *     Browsers reject `permissions.request` made outside a user activation.
 */

import { browser } from "@/lib/browser-api"

/** Discrete API permissions gated behind explicit consent. */
export type OptionalApiPermission =
  | "bookmarks"
  | "history"
  | "notifications"
  | "downloads"
  | "tabGroups"
  | "alarms"

/**
 * `alarms` is genuinely requestable at runtime in Chrome MV3, but
 * `@types/webextension-polyfill` classifies it as a standing (non-optional)
 * permission, so the permission-API arg types reject it. This wraps the cast in
 * one place — the underlying runtime call is valid.
 */
const permissionArg = (perm: OptionalApiPermission) =>
  ({ permissions: [perm] }) as unknown as Parameters<
    typeof browser.permissions.request
  >[0]

/** Is the optional permission currently granted? Never throws. */
export const hasPermission = async (
  perm: OptionalApiPermission
): Promise<boolean> => {
  try {
    return await browser.permissions.contains(permissionArg(perm))
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
    return await browser.permissions.request(permissionArg(perm))
  } catch {
    return false
  }
}

/** Revoke an optional permission. Returns whether removal succeeded. Never throws. */
export const removePermission = async (
  perm: OptionalApiPermission
): Promise<boolean> => {
  try {
    return await browser.permissions.remove(permissionArg(perm))
  } catch {
    return false
  }
}
