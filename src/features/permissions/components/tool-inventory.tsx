import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { MiniBadge } from "@/components/ui/mini-badge"
import { browser } from "@/lib/browser-api"
import { hasPermission, type OptionalApiPermission } from "@/lib/permissions"
import { getToolRegistry, type ToolDefinition } from "@/lib/tools"
import { getToolFamily, type ToolFamily } from "@/lib/tools/tool-families"
import type { ToolFamilySettings } from "@/lib/tools/tool-settings"

const PERMISSION_BY_TOOL: Partial<
  Record<string, OptionalApiPermission | OptionalApiPermission[]>
> = {
  get_recent_history: "history",
  search_bookmarks: "bookmarks",
  list_recently_closed: "sessions",
  restore_session: "sessions",
  list_synced_sessions: "sessions",
  list_tab_groups: "tabGroups",
  read_tab_group: "tabGroups",
  schedule_reminder: ["notifications", "alarms"],
  cancel_reminder: "alarms",
  save_artifact: "downloads"
}

interface ToolAvailability {
  enabled: boolean
  missingPermission: boolean
}

export const ToolInventory = ({
  settings
}: {
  settings: ToolFamilySettings
}) => {
  const { t } = useTranslation()
  const [tools, setTools] = useState<ToolDefinition[]>([])
  const [permissionState, setPermissionState] = useState<
    Record<string, boolean>
  >({})

  useEffect(() => {
    let active = true
    getToolRegistry()
      .listDefinitions()
      .then((definitions) => {
        if (active) setTools(definitions)
      })
      .catch(() => {
        if (active) setTools([])
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    const permissions = Array.from(
      new Set(
        Object.values(PERMISSION_BY_TOOL)
          .flatMap((permission) =>
            Array.isArray(permission) ? permission : [permission]
          )
          .filter(Boolean)
      )
    ) as OptionalApiPermission[]
    const refresh = () => {
      Promise.all(
        permissions.map(async (permission) => [
          permission,
          await hasPermission(permission)
        ])
      )
        .then((entries) => {
          if (active) setPermissionState(Object.fromEntries(entries))
        })
        .catch(() => {
          // Permission API unavailable; leave current state intact.
        })
    }
    refresh()
    browser.permissions?.onAdded?.addListener(refresh)
    browser.permissions?.onRemoved?.addListener(refresh)
    return () => {
      active = false
      browser.permissions?.onAdded?.removeListener(refresh)
      browser.permissions?.onRemoved?.removeListener(refresh)
    }
  }, [])

  const grouped = useMemo(() => {
    const groups = new Map<ToolFamily, ToolDefinition[]>()
    for (const tool of tools) {
      const family = getToolFamily(tool)
      const current = groups.get(family) ?? []
      current.push(tool)
      groups.set(family, current)
    }
    return Array.from(groups.entries())
  }, [tools])

  const availabilityFor = (tool: ToolDefinition): ToolAvailability => {
    const family = getToolFamily(tool)
    const required = PERMISSION_BY_TOOL[tool.name]
    const permissions = Array.isArray(required)
      ? required
      : required
        ? [required]
        : []
    return {
      enabled: settings.enabled && settings.families[family],
      missingPermission: permissions.some(
        (permission) => permissionState[permission] === false
      )
    }
  }

  return (
    <div className="grid gap-3 border-t pt-3">
      <div>
        <p className="text-sm font-medium">
          {t("settings.permissions.tools.inventory.title")}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("settings.permissions.tools.inventory.description")}
        </p>
      </div>
      <div className="grid gap-3">
        {grouped.map(([family, familyTools]) => (
          <div key={family} className="grid gap-1">
            <p className="text-2xs font-medium uppercase text-muted-foreground">
              {t(`settings.permissions.tools.families.${family}.label`)}
            </p>
            <div className="divide-y divide-border/35 rounded-control border border-border/35">
              {familyTools.map((tool) => {
                const availability = availabilityFor(tool)
                const status = !availability.enabled
                  ? t("settings.permissions.tools.inventory.disabled")
                  : availability.missingPermission
                    ? t(
                        "settings.permissions.tools.inventory.permissionRequired"
                      )
                    : t("settings.permissions.tools.inventory.available")
                return (
                  <div
                    key={tool.name}
                    className="flex min-w-0 items-center justify-between gap-2 px-2 py-1.5"
                    title={tool.description}>
                    <code className="min-w-0 truncate text-2xs">
                      {tool.name}
                    </code>
                    <MiniBadge text={status} />
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
