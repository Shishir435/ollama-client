import { supportsSessions, supportsTabGroups } from "@/lib/browser-api"
import {
  matchesOptionalPermissionIntent,
  type OptionalPermissionCapabilityId
} from "@/lib/optional-permission-intent"
import { hasPermission, type OptionalApiPermission } from "@/lib/permissions"
import type { PermissionNotice } from "@/types"

interface OptionalPermissionCapability {
  id: OptionalPermissionCapabilityId
  permissions: OptionalApiPermission[]
  labelKey: string
  available: () => boolean
}

const FOCUS_ID_BY_PERMISSION: Record<OptionalApiPermission, string> = {
  bookmarks: "permission-bookmarks",
  history: "permission-history",
  notifications: "permission-notifications",
  downloads: "permission-downloads",
  tabGroups: "permission-tab-groups",
  alarms: "permission-alarms",
  sessions: "permission-sessions"
}

const OPTIONAL_PERMISSION_CAPABILITIES: OptionalPermissionCapability[] = [
  {
    id: "bookmarks",
    permissions: ["bookmarks"],
    labelKey: "settings.permissions.items.bookmarks.label",
    available: () => true
  },
  {
    id: "history",
    permissions: ["history"],
    labelKey: "settings.permissions.items.history.label",
    available: () => true
  },
  {
    id: "downloads",
    permissions: ["downloads"],
    labelKey: "settings.permissions.items.downloads.label",
    available: () => true
  },
  {
    id: "tabGroups",
    permissions: ["tabGroups"],
    labelKey: "settings.permissions.items.tabGroups.label",
    available: supportsTabGroups
  },
  {
    id: "sessions",
    permissions: ["sessions"],
    labelKey: "settings.permissions.items.sessions.label",
    available: supportsSessions
  },
  {
    id: "reminders",
    permissions: ["alarms", "notifications"],
    labelKey: "chat.permissions.reminders",
    available: () => true
  }
]

/**
 * Resolve the first chat capability explicitly requested by the user whose
 * browser permission is off. This is presentation evidence only: the
 * background tool policy remains the privacy boundary.
 */
export const findOptionalPermissionNotice = async (
  text: string
): Promise<PermissionNotice | undefined> => {
  const normalized = text.trim()
  if (!normalized) return undefined

  for (const capability of OPTIONAL_PERMISSION_CAPABILITIES) {
    if (
      !capability.available() ||
      !matchesOptionalPermissionIntent(capability.id, normalized)
    ) {
      continue
    }

    const granted = await Promise.all(
      capability.permissions.map((permission) => hasPermission(permission))
    )
    const missingPermissions = capability.permissions.filter(
      (_, index) => !granted[index]
    )
    if (missingPermissions.length === 0) continue

    return {
      capabilityId: capability.id,
      focusId: FOCUS_ID_BY_PERMISSION[missingPermissions[0]],
      labelKey: capability.labelKey,
      missingPermissions
    }
  }

  return undefined
}
