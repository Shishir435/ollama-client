import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  SettingsActionRow,
  SettingsCard,
  SettingsLevelGate,
  SettingsSwitch
} from "@/components/settings"
import { Button } from "@/components/ui/button"
import { ApprovalsCard } from "@/features/permissions/components/approvals-card"
import { ModelToolsCard } from "@/features/permissions/components/model-tools-card"
import { browser, supportsSessions, supportsTabGroups } from "@/lib/browser-api"
import {
  DEFAULT_TABS_ACCESS,
  MESSAGE_KEYS,
  STORAGE_KEYS
} from "@/lib/constants"
import { Globe, Lock, Sparkles } from "@/lib/lucide-icon"
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

      <SettingsLevelGate settingId="model-tools">
        <ModelToolsCard compact={compact} />
      </SettingsLevelGate>

      {!compact && <ApprovalsCard />}

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
        <SettingsLevelGate settingId="scheduled-job-vector-maintenance">
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
        </SettingsLevelGate>
      )}
    </div>
  )
}
