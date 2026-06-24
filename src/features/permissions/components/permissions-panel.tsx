import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  SettingsActionRow,
  SettingsCard,
  SettingsSwitch
} from "@/components/settings"
import { Button } from "@/components/ui/button"
import { browser, supportsTabGroups } from "@/lib/browser-api"
import { MESSAGE_KEYS } from "@/lib/constants"
import { Bot, Globe, Lock, Sparkles } from "@/lib/lucide-icon"
import {
  hasPermission,
  type OptionalApiPermission,
  removePermission,
  requestPermission
} from "@/lib/permissions"
import {
  getScheduledJobSettings,
  type ScheduledJobId,
  setScheduledJobEnabled
} from "@/lib/scheduled-jobs"
import { TOOL_FAMILIES, type ToolFamily } from "@/lib/tools/tool-families"
import {
  getToolFamilySettings,
  setToolFamilyEnabled,
  setToolMasterEnabled,
  type ToolFamilySettings
} from "@/lib/tools/tool-settings"
import { type FeatureFlag, useFeatureFlagsStore } from "@/stores/feature-flags"

/**
 * Shared privacy / permissions surface (v0.11.0 groundwork — FEATURE_ROADMAP §5
 * item 7, C1). Reused in two homes: the Options "Permissions" tab and the chat
 * context popover (pass `compact`). It is the one place users see and revoke
 * optional browser access and toggle preview features.
 *
 * Scope: optional API permissions + preview flags + a read-only note that host
 * access (`<all_urls>`) is standing and intentionally not revocable here (§0.4).
 * As E2/E3/E5/E9 land they add their own data (vector counts, site rules) here.
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
  { perm: "alarms", focusId: "permission-alarms", available: () => true }
]

/**
 * Preview-flag labels are developer-facing and stay in code (not i18n) — these
 * are experimental toggles, not polished end-user copy.
 */
const FLAG_LABELS: Record<FeatureFlag, string> = {
  omnibox: "Omnibox quick-ask",
  bookmarksHistoryRag: "Bookmarks & history knowledge",
  perSiteProfiles: "Per-site context profiles",
  tabGroups: "Tab-group workflows",
  templateChaining: "Template variables & chaining",
  downloads: "Save generated artifacts",
  browserTools: "Browser actions as tools"
}

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
    hasPermission(meta.perm).then((value) => {
      if (active) setGranted(value)
    })
    return () => {
      active = false
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
 * Model-tools governance (E10). Master switch + one toggle per tool family,
 * gating which model-callable tools `resolveModelTools` offers. Family toggles
 * stay interactive while the master is off (so users can pre-configure), but dim
 * to signal the master overrides them.
 */
const ModelToolsCard = () => {
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
  const flags = useFeatureFlagsStore((s) => s.flags)
  const setFlag = useFeatureFlagsStore((s) => s.setFlag)
  const [permissionRefreshKey, setPermissionRefreshKey] = useState(0)

  const refreshPermissionRows = useCallback(() => {
    setPermissionRefreshKey((value) => value + 1)
  }, [])

  // Preview-flag toggles are a dev/QA control, not end-user UI. Hidden in the
  // production build; the flag store still gates in-progress code paths. Flags
  // are disposable — delete each one once its feature ships stable and on.
  const showPreviewFeatures = process.env.NODE_ENV !== "production"

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

      <ModelToolsCard />

      {!compact && (
        <SettingsCard
          focusId="permissions-host"
          icon={Globe}
          title={t("settings.permissions.host.title")}
          description={t("settings.permissions.host.description")}
        />
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

      {showPreviewFeatures && (
        <SettingsCard
          focusId="permissions-preview"
          icon={Sparkles}
          title={t("settings.permissions.preview.title")}
          description={t("settings.permissions.preview.description")}>
          {(Object.keys(FLAG_LABELS) as FeatureFlag[]).map((flag) => (
            <SettingsSwitch
              key={flag}
              id={`feature-flag-${flag}`}
              label={FLAG_LABELS[flag]}
              checked={flags[flag]}
              onCheckedChange={(next) => setFlag(flag, next)}
            />
          ))}
        </SettingsCard>
      )}
    </div>
  )
}
