import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { SettingsCard, SettingsSwitch } from "@/components/settings"
import { supportsTabGroups } from "@/lib/browser-api"
import { Globe, Lock, Sparkles } from "@/lib/lucide-icon"
import {
  hasPermission,
  type OptionalApiPermission,
  removePermission,
  requestPermission
} from "@/lib/permissions"
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
  }
]

/**
 * Preview-flag labels are developer-facing and stay in code (not i18n) — these
 * are experimental toggles, not polished end-user copy.
 */
const FLAG_LABELS: Record<FeatureFlag, string> = {
  screenshotVision: "Screenshot → vision",
  notifications: "Background notifications",
  omnibox: "Omnibox quick-ask",
  bookmarksHistoryRag: "Bookmarks & history knowledge",
  perSiteProfiles: "Per-site context profiles",
  tabGroups: "Tab-group workflows",
  artifactsCanvas: "Artifacts / output canvas",
  templateChaining: "Template variables & chaining",
  downloads: "Save generated artifacts",
  browserTools: "Browser actions as tools"
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
      const ok = next
        ? await requestPermission(meta.perm)
        : !(await removePermission(meta.perm))
      setGranted(ok ? next : await hasPermission(meta.perm))
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

  return (
    <div className="grid gap-4">
      <SettingsCard
        focusId="permissions"
        icon={Lock}
        title={t("settings.permissions.optional.title")}
        description={t("settings.permissions.optional.description")}>
        {OPTIONAL_PERMISSIONS.filter((m) => m.available()).map((meta) => (
          <OptionalPermissionRow
            key={meta.perm}
            meta={meta}
            label={t(`settings.permissions.items.${meta.perm}.label`)}
            description={t(
              `settings.permissions.items.${meta.perm}.description`
            )}
          />
        ))}
      </SettingsCard>

      {!compact && (
        <SettingsCard
          focusId="permissions-host"
          icon={Globe}
          title={t("settings.permissions.host.title")}
          description={t("settings.permissions.host.description")}
        />
      )}

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
    </div>
  )
}
