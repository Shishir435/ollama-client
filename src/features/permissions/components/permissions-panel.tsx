import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  SettingsActionRow,
  SettingsCard,
  SettingsSwitch
} from "@/components/settings"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { useProviderModels } from "@/features/model/hooks/use-provider-models"
import { browser, supportsSessions, supportsTabGroups } from "@/lib/browser-api"
import {
  DEFAULT_PROVIDER_ID,
  DEFAULT_TABS_ACCESS,
  MESSAGE_KEYS,
  STORAGE_KEYS
} from "@/lib/constants"
import { Bot, Globe, Lock, Sparkles } from "@/lib/lucide-icon"
import {
  hasPermission,
  type OptionalApiPermission,
  removePermission,
  requestPermission
} from "@/lib/permissions"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import {
  getScheduledJobSettings,
  type ScheduledJobId,
  setScheduledJobEnabled
} from "@/lib/scheduled-jobs"
import { TOOL_FAMILIES, type ToolFamily } from "@/lib/tools/tool-families"
import {
  clearToolModelOverride,
  getAllToolModelOverrides,
  getEffectiveToolFamilySettings,
  patchToolModelOverride,
  type ToolFamilyOverride,
  type ToolModelOverrideMap,
  toolModelOverrideKey
} from "@/lib/tools/tool-model-overrides"
import {
  getToolFamilySettings,
  setToolFamilyEnabled,
  setToolMasterEnabled,
  type ToolFamilySettings
} from "@/lib/tools/tool-settings"

/**
 * Shared privacy / permissions surface. Reused in the Options "Permissions"
 * tab and chat context popover (pass `compact`). It is the one place users see
 * and revoke optional browser access.
 *
 * Scope: optional API permissions + a read-only note that host access
 * (`<all_urls>`) is standing and intentionally not revocable here.
 */

interface OptionalPermissionMeta {
  perm: OptionalApiPermission
  /** Focus id = `data-settings-focus-id` for search/deep-link. */
  focusId: string
  /** Only render when the running browser supports the capability. */
  available: () => boolean
}

const OPTIONAL_PERMISSIONS: OptionalPermissionMeta[] = [
  { perm: "bookmarks", focusId: "permission-bookmarks", available: () => true },
  { perm: "history", focusId: "permission-history", available: () => true },
  {
    perm: "notifications",
    focusId: "permission-notifications",
    available: () => true
  },
  { perm: "downloads", focusId: "permission-downloads", available: () => true },
  {
    perm: "tabGroups",
    focusId: "permission-tab-groups",
    available: supportsTabGroups
  },
  { perm: "alarms", focusId: "permission-alarms", available: () => true },
  {
    perm: "sessions",
    focusId: "permission-sessions",
    available: supportsSessions
  }
]

const SCHEDULED_JOB_LABELS: Record<
  ScheduledJobId,
  { labelKey: string; descriptionKey: string }
> = {
  "vector-maintenance": {
    labelKey: "settings.permissions.scheduled.items.vectorMaintenance.label",
    descriptionKey:
      "settings.permissions.scheduled.items.vectorMaintenance.description"
  }
}

const TabAccessSettings = () => {
  const { t } = useTranslation()
  const [tabAccess, setTabAccess] = useState(DEFAULT_TABS_ACCESS)

  useEffect(() => {
    let active = true
    plasmoGlobalStorage
      .get<boolean>(STORAGE_KEYS.BROWSER.TABS_ACCESS)
      .then((stored) => {
        if (active) setTabAccess(stored ?? DEFAULT_TABS_ACCESS)
      })
      .catch(() => {
        // Fall back to the default on a storage read error rather than
        // leaving an unhandled rejection.
      })
    return () => {
      active = false
    }
  }, [])

  const onCheckedChange = async (next: boolean) => {
    setTabAccess(next)
    await plasmoGlobalStorage.set(STORAGE_KEYS.BROWSER.TABS_ACCESS, next)
  }

  return (
    <SettingsSwitch
      id="browser-tab-access"
      label={t("settings.presets.fields.tab_access")}
      checked={tabAccess}
      onCheckedChange={onCheckedChange}
    />
  )
}

const OptionalPermissionRow = ({
  meta,
  label,
  description
}: {
  meta: OptionalPermissionMeta
  label: string
  description: string
}) => {
  const [granted, setGranted] = useState(false)

  useEffect(() => {
    let active = true
    const refresh = () =>
      hasPermission(meta.perm).then((value) => {
        if (active) setGranted(value)
      })
    const onChanged = (permissions: { permissions?: string[] }) => {
      if (permissions.permissions?.includes(meta.perm)) void refresh()
    }

    refresh().catch(() => undefined)
    browser.permissions?.onAdded?.addListener(onChanged)
    browser.permissions?.onRemoved?.addListener(onChanged)

    return () => {
      active = false
      browser.permissions?.onAdded?.removeListener(onChanged)
      browser.permissions?.onRemoved?.removeListener(onChanged)
    }
  }, [meta.perm])

  const onToggle = useCallback(
    async (next: boolean) => {
      // Must run from this click (user gesture) for the browser to honor request.
      if (next) {
        await requestPermission(meta.perm)
      } else {
        await removePermission(meta.perm)
      }
      // Re-query the real state so a denied request or failed revoke never shows
      // a misleading granted/revoked signal.
      setGranted(await hasPermission(meta.perm))
    },
    [meta.perm]
  )

  return (
    <SettingsSwitch
      id={meta.focusId}
      label={label}
      description={description}
      checked={granted}
      onCheckedChange={onToggle}
    />
  )
}

const TestNotificationButton = ({
  onPermissionStateChanged
}: {
  onPermissionStateChanged: () => void
}) => {
  const { t } = useTranslation()
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const sendTestNotification = useCallback(async () => {
    setSending(true)
    setStatus(null)
    try {
      const granted =
        (await hasPermission("notifications")) ||
        (await requestPermission("notifications"))

      if (!granted) {
        setStatus(t("settings.permissions.items.notifications.testDenied"))
        return
      }
      onPermissionStateChanged()

      const response = (await browser.runtime.sendMessage({
        type: MESSAGE_KEYS.APP.NOTIFY_JOB_COMPLETE,
        payload: {
          id: "test-notification",
          title: t("settings.permissions.items.notifications.testTitle"),
          message: t("settings.permissions.items.notifications.testMessage")
        }
      })) as {
        success?: boolean
        data?: { sent?: boolean; reason?: string; error?: string }
        error?: { message?: string }
      }

      if (response?.data?.sent || response?.success) {
        setStatus(t("settings.permissions.items.notifications.testSent"))
      } else {
        const reason =
          response?.data?.reason ||
          response?.error?.message ||
          response?.data?.error ||
          "no runtime response"
        setStatus(
          t("settings.permissions.items.notifications.testSkipped", { reason })
        )
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      setStatus(
        t("settings.permissions.items.notifications.testSkipped", { reason })
      )
    } finally {
      setSending(false)
    }
  }, [onPermissionStateChanged, t])

  return (
    <div className="grid gap-2">
      <SettingsActionRow>
        <Button
          type="button"
          variant="outline"
          onClick={sendTestNotification}
          disabled={sending}>
          {t("settings.permissions.items.notifications.testButton")}
        </Button>
      </SettingsActionRow>
      {status && <p className="text-sm text-muted-foreground">{status}</p>}
    </div>
  )
}

const ScheduledJobRow = ({
  jobId,
  label,
  description
}: {
  jobId: ScheduledJobId
  label: string
  description: string
}) => {
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    let active = true
    getScheduledJobSettings().then((settings) => {
      if (active) setEnabled(settings.enabled[jobId])
    })
    return () => {
      active = false
    }
  }, [jobId])

  const onToggle = useCallback(
    async (next: boolean) => {
      const settings = await setScheduledJobEnabled(jobId, next)
      setEnabled(settings.enabled[jobId])
    },
    [jobId]
  )

  return (
    <SettingsSwitch
      id={`scheduled-job-${jobId}`}
      label={label}
      description={description}
      checked={enabled}
      onCheckedChange={onToggle}
    />
  )
}

/**
 * Per-model tool overrides (0.11.18). A model picker plus the same master +
 * family toggles, but writing a per-model overlay over the global defaults
 * instead of the globals. Options-only (not the compact popover), since it needs
 * the provider model list. Toggling pins that field for the chosen model; "Reset"
 * drops the whole override so the model follows the globals again.
 */
const ModelToolOverridesSection = () => {
  const { t } = useTranslation()
  const { models } = useProviderModels()
  const [overrides, setOverrides] = useState<ToolModelOverrideMap>({})
  const [targetKey, setTargetKey] = useState("")
  const [effective, setEffective] = useState<ToolFamilySettings | null>(null)

  const entries = useMemo(
    () =>
      (models ?? []).map((model) => {
        const providerId = model.providerId || DEFAULT_PROVIDER_ID
        return {
          providerId,
          name: model.name,
          key: toolModelOverrideKey(providerId, model.name)
        }
      }),
    [models]
  )

  const reloadOverrides = useCallback(() => {
    getAllToolModelOverrides().then(setOverrides)
  }, [])

  useEffect(() => {
    reloadOverrides()
  }, [reloadOverrides])

  const target = entries.find((entry) => entry.key === targetKey) ?? null
  const targetProviderId = target?.providerId
  const targetName = target?.name

  const loadEffective = useCallback(
    async (providerId?: string, name?: string) => {
      if (!providerId || !name) {
        setEffective(null)
        return
      }
      setEffective(await getEffectiveToolFamilySettings(providerId, name))
    },
    []
  )

  // Reload the chosen model's effective settings when the selection changes.
  // Writes (applyChange/onReset) call loadEffective directly afterward.
  useEffect(() => {
    loadEffective(targetProviderId, targetName)
  }, [targetProviderId, targetName, loadEffective])

  if (entries.length === 0) {
    return (
      <p
        data-settings-focus-id="model-tools-per-model"
        className="border-t pt-3 text-xs text-muted-foreground">
        {t("settings.permissions.tools.perModel.empty")}
      </p>
    )
  }

  const applyChange = async (patch: ToolFamilyOverride) => {
    if (!target) return
    // Merge happens in storage (patchToolModelOverride), not from `overrides`
    // state, so two quick toggles before a reload resolves don't clobber.
    await patchToolModelOverride(target.providerId, target.name, patch)
    reloadOverrides()
    await loadEffective(target.providerId, target.name)
  }

  const onReset = async () => {
    if (!target) return
    await clearToolModelOverride(target.providerId, target.name)
    reloadOverrides()
    await loadEffective(target.providerId, target.name)
  }

  const hasOverride = target ? Boolean(overrides[target.key]) : false

  return (
    <div className="grid gap-2 border-t pt-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">
          {t("settings.permissions.tools.perModel.title")}
        </span>
        <span className="text-xs text-muted-foreground">
          {t("settings.permissions.tools.perModel.description")}
        </span>
      </div>

      <Select
        value={targetKey}
        onValueChange={(value) => {
          if (value !== null) setTargetKey(value)
        }}>
        <SelectTrigger
          data-settings-focus-id="model-tools-per-model"
          className="w-full">
          <SelectValue
            placeholder={t(
              "settings.permissions.tools.perModel.selectPlaceholder"
            )}
          />
        </SelectTrigger>
        <SelectContent>
          {entries.map((entry) => (
            <SelectItem key={entry.key} value={entry.key}>
              {entry.name}
              {overrides[entry.key]
                ? ` · ${t("settings.permissions.tools.perModel.customBadge")}`
                : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {target && effective && (
        <div className="grid gap-2">
          <SettingsSwitch
            id="model-tools-override-master"
            label={t("settings.permissions.tools.master.label")}
            checked={effective.enabled}
            onCheckedChange={(next) => applyChange({ enabled: next })}
          />
          <div
            className={effective.enabled ? undefined : "opacity-60"}
            aria-disabled={!effective.enabled}>
            <div className="grid gap-2">
              {TOOL_FAMILIES.map((family) => (
                <SettingsSwitch
                  key={family}
                  id={`model-tools-override-family-${family}`}
                  label={t(
                    `settings.permissions.tools.families.${family}.label`
                  )}
                  checked={effective.families[family]}
                  onCheckedChange={(next) =>
                    applyChange({ families: { [family]: next } })
                  }
                />
              ))}
            </div>
          </div>
          <SettingsSwitch
            id="model-tools-override-nonnative-fallback"
            label={t(
              "settings.permissions.tools.perModel.nonNativeFallback.label"
            )}
            description={t(
              "settings.permissions.tools.perModel.nonNativeFallback.description"
            )}
            checked={Boolean(overrides[target.key]?.nonNativeToolFallback)}
            onCheckedChange={(next) =>
              applyChange({ nonNativeToolFallback: next })
            }
          />
          {hasOverride && (
            <SettingsActionRow>
              <Button variant="ghost" size="sm" onClick={onReset}>
                {t("settings.permissions.tools.perModel.reset")}
              </Button>
            </SettingsActionRow>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Model-tools governance (E10). Master switch + one toggle per tool family,
 * gating which model-callable tools `resolveModelTools` offers. Family toggles
 * stay interactive while the master is off (so users can pre-configure), but dim
 * to signal the master overrides them. Per-model overrides (0.11.18) render below
 * in the full (options) layout only.
 */
const ModelToolsCard = ({ compact }: { compact: boolean }) => {
  const { t } = useTranslation()
  const [settings, setSettings] = useState<ToolFamilySettings | null>(null)

  useEffect(() => {
    let active = true
    getToolFamilySettings().then((value) => {
      if (active) setSettings(value)
    })
    return () => {
      active = false
    }
  }, [])

  if (!settings) return null

  const onMaster = async (next: boolean) => {
    setSettings(await setToolMasterEnabled(next))
  }
  const onFamily = (family: ToolFamily) => async (next: boolean) => {
    setSettings(await setToolFamilyEnabled(family, next))
  }

  return (
    <SettingsCard
      focusId="model-tools"
      icon={Bot}
      title={t("settings.permissions.tools.title")}
      description={t("settings.permissions.tools.description")}>
      <SettingsSwitch
        id="model-tools-master"
        label={t("settings.permissions.tools.master.label")}
        description={t("settings.permissions.tools.master.description")}
        checked={settings.enabled}
        onCheckedChange={onMaster}
      />
      <div
        className={settings.enabled ? undefined : "opacity-60"}
        aria-disabled={!settings.enabled}>
        <div className="grid gap-2">
          {TOOL_FAMILIES.map((family) => (
            <SettingsSwitch
              key={family}
              id={`model-tools-family-${family}`}
              label={t(`settings.permissions.tools.families.${family}.label`)}
              description={t(
                `settings.permissions.tools.families.${family}.description`
              )}
              checked={settings.families[family]}
              onCheckedChange={onFamily(family)}
            />
          ))}
        </div>
      </div>
      {!compact && <ModelToolOverridesSection />}
    </SettingsCard>
  )
}

export interface PermissionsPanelProps {
  /** Denser layout + omit the host-access note, for the context popover. */
  compact?: boolean
}

export const PermissionsPanel = ({
  compact = false
}: PermissionsPanelProps) => {
  const { t } = useTranslation()
  const [permissionRefreshKey, setPermissionRefreshKey] = useState(0)

  const refreshPermissionRows = useCallback(() => {
    setPermissionRefreshKey((value) => value + 1)
  }, [])

  return (
    <div className="grid gap-4">
      <SettingsCard
        focusId="permissions"
        icon={Lock}
        title={t("settings.permissions.optional.title")}
        description={t("settings.permissions.optional.description")}>
        {OPTIONAL_PERMISSIONS.filter((m) => m.available()).map((meta) => (
          <OptionalPermissionRow
            key={`${meta.perm}-${permissionRefreshKey}`}
            meta={meta}
            label={t(`settings.permissions.items.${meta.perm}.label`)}
            description={t(
              `settings.permissions.items.${meta.perm}.description`
            )}
          />
        ))}
        <TestNotificationButton
          onPermissionStateChanged={refreshPermissionRows}
        />
      </SettingsCard>

      <ModelToolsCard compact={compact} />

      {!compact && (
        <SettingsCard
          focusId="permissions-host"
          icon={Globe}
          title={t("settings.permissions.host.title")}
          description={t("settings.permissions.host.description")}>
          <TabAccessSettings />
        </SettingsCard>
      )}

      {!compact && (
        <SettingsCard
          focusId="permissions-scheduled-jobs"
          icon={Sparkles}
          title={t("settings.permissions.scheduled.title")}
          description={t("settings.permissions.scheduled.description")}>
          {(Object.keys(SCHEDULED_JOB_LABELS) as ScheduledJobId[]).map(
            (jobId) => (
              <ScheduledJobRow
                key={jobId}
                jobId={jobId}
                label={t(SCHEDULED_JOB_LABELS[jobId].labelKey)}
                description={t(SCHEDULED_JOB_LABELS[jobId].descriptionKey)}
              />
            )
          )}
        </SettingsCard>
      )}
    </div>
  )
}
