import { useStorage } from "@plasmohq/storage/hook"
import { useId, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import { SettingsActionRow, SettingsCard } from "@/components/settings"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { browser } from "@/lib/browser-api"
import { STORAGE_KEYS } from "@/lib/constants"
import { Globe, Plus, Shield, Trash2 } from "@/lib/lucide-icon"
import {
  createPerSiteProfile,
  DEFAULT_PER_SITE_PROFILE_SETTINGS,
  type PerSiteProfile,
  type PerSiteProfileSettings,
  type PerSiteRuleMode,
  profilePatternMatchesUrl
} from "@/lib/per-site-profiles"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { cn } from "@/lib/utils"

const RULE_MODES: PerSiteRuleMode[] = ["inherit", "always", "never"]

const getCurrentTabPattern = async (): Promise<string> => {
  const [tab] = await browser.tabs.query({
    active: true,
    currentWindow: true
  })
  if (!tab?.url) return ""
  try {
    return new URL(tab.url).hostname
  } catch {
    return tab.url
  }
}

const PerSiteRuleSelect = ({
  value,
  onValueChange,
  label
}: {
  value: PerSiteRuleMode
  onValueChange: (value: PerSiteRuleMode) => void
  label: string
}) => {
  const { t } = useTranslation()
  return (
    <div className="grid min-w-0 gap-1">
      <span className="text-[11px] font-medium text-muted-foreground">
        {label}
      </span>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className="h-8 w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RULE_MODES.map((mode) => (
            <SelectItem key={mode} value={mode}>
              {t(`settings.permissions.siteProfiles.modes.${mode}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

const PerSiteProfileRow = ({
  profile,
  onChange,
  onDelete
}: {
  profile: PerSiteProfile
  onChange: (next: PerSiteProfile) => void
  onDelete: () => void
}) => {
  const { t } = useTranslation()
  const nameId = useId()
  const patternId = useId()
  return (
    <div
      className={cn(
        "grid gap-3 rounded-lg border border-border/60 bg-background/35 p-3",
        !profile.enabled && "opacity-70"
      )}>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Switch
            checked={profile.enabled}
            onCheckedChange={(enabled) => onChange({ ...profile, enabled })}
            aria-label={t("settings.permissions.siteProfiles.fields.enabled")}
          />
          <span className="truncate text-sm font-medium">
            {profile.name || profile.pattern}
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onDelete}
          aria-label={t("settings.permissions.siteProfiles.actions.delete")}>
          <Trash2 className="icon-sm" />
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 gap-1">
          <label
            htmlFor={nameId}
            className="text-[11px] font-medium text-muted-foreground">
            {t("settings.permissions.siteProfiles.fields.name")}
          </label>
          <Input
            id={nameId}
            value={profile.name}
            onChange={(event) =>
              onChange({ ...profile, name: event.target.value })
            }
            placeholder={t(
              "settings.permissions.siteProfiles.placeholders.name"
            )}
          />
        </div>
        <div className="grid min-w-0 gap-1">
          <label
            htmlFor={patternId}
            className="text-[11px] font-medium text-muted-foreground">
            {t("settings.permissions.siteProfiles.fields.pattern")}
          </label>
          <Input
            id={patternId}
            value={profile.pattern}
            onChange={(event) =>
              onChange({ ...profile, pattern: event.target.value })
            }
            placeholder={t(
              "settings.permissions.siteProfiles.placeholders.pattern"
            )}
          />
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <PerSiteRuleSelect
          value={profile.tabContext}
          onValueChange={(tabContext) => onChange({ ...profile, tabContext })}
          label={t("settings.permissions.siteProfiles.fields.tabContext")}
        />
        <PerSiteRuleSelect
          value={profile.groundedOnly}
          onValueChange={(groundedOnly) =>
            onChange({ ...profile, groundedOnly })
          }
          label={t("settings.permissions.siteProfiles.fields.groundedOnly")}
        />
      </div>
    </div>
  )
}

export const PerSiteProfilesEditor = () => {
  const { t } = useTranslation()
  const [settings, setSettings] = useStorage<PerSiteProfileSettings>(
    {
      key: STORAGE_KEYS.BROWSER.PER_SITE_PROFILES,
      instance: plasmoGlobalStorage
    },
    DEFAULT_PER_SITE_PROFILE_SETTINGS
  )
  const [draftPattern, setDraftPattern] = useState("")

  const profiles = settings?.profiles ?? []
  const normalizedDraft = draftPattern.trim()

  const matchPreview = useMemo(() => {
    if (!normalizedDraft) return null
    return profiles.find((profile) =>
      profilePatternMatchesUrl(profile.pattern, normalizedDraft)
    )
  }, [normalizedDraft, profiles])

  const updateProfiles = (next: PerSiteProfile[]) => {
    setSettings({ profiles: next.filter((profile) => profile.pattern.trim()) })
  }

  const addProfile = (pattern = normalizedDraft) => {
    const trimmed = pattern.trim()
    if (!trimmed) return
    updateProfiles([
      ...profiles,
      createPerSiteProfile({
        name: trimmed,
        pattern: trimmed,
        tabContext: "never",
        groundedOnly: "inherit"
      })
    ])
    setDraftPattern("")
  }

  const addCurrentSite = async () => {
    const pattern = await getCurrentTabPattern()
    if (pattern) addProfile(pattern)
  }

  return (
    <SettingsCard
      focusId="permissions-site-profiles"
      icon={Shield}
      title={t("settings.permissions.siteProfiles.title")}
      description={t("settings.permissions.siteProfiles.description")}>
      <div className="grid gap-2">
        <SettingsActionRow>
          <Input
            value={draftPattern}
            onChange={(event) => setDraftPattern(event.target.value)}
            placeholder={t(
              "settings.permissions.siteProfiles.placeholders.add"
            )}
            aria-label={t("settings.permissions.siteProfiles.fields.pattern")}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => addProfile()}
            disabled={!normalizedDraft}>
            <Plus className="icon-sm" />
            {t("settings.permissions.siteProfiles.actions.add")}
          </Button>
          <Button type="button" variant="ghost" onClick={addCurrentSite}>
            <Globe className="icon-sm" />
            {t("settings.permissions.siteProfiles.actions.currentSite")}
          </Button>
        </SettingsActionRow>
        {matchPreview && (
          <p className="text-xs text-muted-foreground">
            {t("settings.permissions.siteProfiles.matchPreview", {
              name: matchPreview.name || matchPreview.pattern
            })}
          </p>
        )}
      </div>

      <div className="grid gap-3">
        {profiles.map((profile) => (
          <PerSiteProfileRow
            key={profile.id}
            profile={profile}
            onChange={(next) =>
              updateProfiles(
                profiles.map((item) => (item.id === profile.id ? next : item))
              )
            }
            onDelete={() =>
              updateProfiles(profiles.filter((item) => item.id !== profile.id))
            }
          />
        ))}
        {profiles.length === 0 && (
          <div className="rounded-lg border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
            {t("settings.permissions.siteProfiles.empty")}
          </div>
        )}
      </div>
    </SettingsCard>
  )
}
