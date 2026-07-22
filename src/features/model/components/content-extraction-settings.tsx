import { useStorage } from "@plasmohq/storage/hook"
import { useTranslation } from "react-i18next"
import { FormGrid, SectionStack } from "@/components/layout"
import {
  AdvancedSection,
  SettingsCard,
  SettingsFormField,
  SettingsLevelGate,
  SettingsSwitch
} from "@/components/settings"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import {
  ScrollDepthField,
  ScrollStrategyField,
  TimeoutInputField
} from "@/features/model/components/content-extraction-fields"
import { ExcludedUrls } from "@/features/model/components/exclude-urls"
import { SiteSpecificOverrides } from "@/features/model/components/site-specific-overrides"
import { SELECTION_ACTIONS } from "@/features/selection-actions/actions"
import {
  DEFAULT_CONTENT_EXTRACTION_CONFIG,
  STORAGE_KEYS
} from "@/lib/constants"
import { CONTENT_SCRAPER_OPTIONS } from "@/lib/constants-ui"
import {
  BookOpen,
  Code,
  FileText,
  Sparkles,
  Target,
  Zap
} from "@/lib/lucide-icon"
import {
  createPerSiteProfile,
  DEFAULT_PER_SITE_PROFILE_SETTINGS,
  type PerSiteProfile,
  type PerSiteProfileSettings
} from "@/lib/per-site-profiles"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { cn } from "@/lib/utils"
import type { ContentExtractionConfig, ContentScraper } from "@/types"
import { TIMEOUT_FIELDS } from "./content-extraction-constants"

export interface ContentExtractionSettingsFormProps {
  config: ContentExtractionConfig
  onUpdate: (updates: Partial<ContentExtractionConfig>) => void
}

export const ContentExtractionSettings = () => {
  const [config, setConfig] = useStorage<ContentExtractionConfig>(
    {
      key: STORAGE_KEYS.BROWSER.CONTENT_EXTRACTION_CONFIG,
      instance: plasmoGlobalStorage
    },
    DEFAULT_CONTENT_EXTRACTION_CONFIG
  )
  const [perSiteProfileSettings, setPerSiteProfileSettings] =
    useStorage<PerSiteProfileSettings>(
      {
        key: STORAGE_KEYS.BROWSER.PER_SITE_PROFILES,
        instance: plasmoGlobalStorage
      },
      DEFAULT_PER_SITE_PROFILE_SETTINGS
    )

  if (!config) {
    return null
  }

  const handleUpdate = (updates: Partial<ContentExtractionConfig>) => {
    setConfig((prev) => ({
      ...(prev ?? DEFAULT_CONTENT_EXTRACTION_CONFIG),
      ...updates
    }))
  }

  // Handler for adding site-specific override
  const handleAddSiteOverride = (pattern: string) => {
    setConfig((prev) => {
      const base = prev ?? DEFAULT_CONTENT_EXTRACTION_CONFIG
      return {
        ...base,
        siteOverrides: {
          ...base.siteOverrides,
          [pattern]: {}
        }
      }
    })
    setPerSiteProfileSettings((prev) => {
      const profiles = prev?.profiles ?? []
      if (profiles.some((profile) => profile.pattern === pattern))
        return prev ?? DEFAULT_PER_SITE_PROFILE_SETTINGS
      return {
        profiles: [
          ...profiles,
          createPerSiteProfile({
            pattern,
            name: pattern
          })
        ]
      }
    })
  }

  // Handler for removing site-specific override
  const handleRemoveSiteOverride = (pattern: string) => {
    setConfig((prev) => {
      const base = prev ?? DEFAULT_CONTENT_EXTRACTION_CONFIG
      const { [pattern]: _, ...remaining } = base.siteOverrides
      return { ...base, siteOverrides: remaining }
    })
    setPerSiteProfileSettings((prev) => ({
      profiles: (prev?.profiles ?? []).filter(
        (profile) => profile.pattern !== pattern
      )
    }))
  }

  // Handler for updating site-specific override
  const handleUpdateSiteOverride = (
    pattern: string,
    updates: Partial<ContentExtractionConfig>
  ) => {
    setConfig((prev) => {
      const base = prev ?? DEFAULT_CONTENT_EXTRACTION_CONFIG
      return {
        ...base,
        siteOverrides: {
          ...base.siteOverrides,
          [pattern]: {
            ...base.siteOverrides[pattern],
            ...updates
          }
        }
      }
    })
  }

  const handleUpdateSiteProfile = (
    pattern: string,
    updates: Partial<Pick<PerSiteProfile, "tabContext" | "groundedOnly">>
  ) => {
    setPerSiteProfileSettings((prev) => {
      const profiles = prev?.profiles ?? []
      const existing = profiles.find((profile) => profile.pattern === pattern)
      const nextProfile = existing
        ? { ...existing, ...updates }
        : createPerSiteProfile({
            pattern,
            name: pattern,
            ...updates
          })
      return {
        profiles: existing
          ? profiles.map((profile) =>
              profile.pattern === pattern ? nextProfile : profile
            )
          : [...profiles, nextProfile]
      }
    })
  }

  // Handler for adding excluded URL pattern
  const handleAddExcludedUrl = (pattern: string) => {
    setConfig((prev) => {
      const base = prev ?? DEFAULT_CONTENT_EXTRACTION_CONFIG
      return {
        ...base,
        excludedUrlPatterns: [...(base.excludedUrlPatterns || []), pattern]
      }
    })
  }

  // Handler for removing excluded URL pattern
  const handleRemoveExcludedUrl = (pattern: string) => {
    setConfig((prev) => {
      const base = prev ?? DEFAULT_CONTENT_EXTRACTION_CONFIG
      return {
        ...base,
        excludedUrlPatterns: (base.excludedUrlPatterns || []).filter(
          (p) => p !== pattern
        )
      }
    })
  }

  return (
    <SectionStack>
      <ContentExtractionSettingsForm config={config} onUpdate={handleUpdate} />

      <SettingsLevelGate settingId="site-overrides">
        <SiteSpecificOverrides
          config={config}
          perSiteProfiles={perSiteProfileSettings?.profiles ?? []}
          onAddSiteOverride={handleAddSiteOverride}
          onRemoveSiteOverride={handleRemoveSiteOverride}
          onUpdateSiteOverride={handleUpdateSiteOverride}
          onUpdateSiteProfile={handleUpdateSiteProfile}
        />
      </SettingsLevelGate>

      <ExcludedUrls
        patterns={config.excludedUrlPatterns || []}
        onAdd={handleAddExcludedUrl}
        onRemove={handleRemoveExcludedUrl}
      />
    </SectionStack>
  )
}

const ContentExtractionSettingsForm = ({
  config,
  onUpdate
}: ContentExtractionSettingsFormProps) => {
  const { t } = useTranslation()

  // Get icon for scraper type
  const getScraperIcon = (scraper: ContentScraper) => {
    switch (scraper) {
      case "auto":
        return Sparkles
      case "defuddle":
        return Code
      case "readability":
        return BookOpen
    }
  }

  // Render content scraper selection
  const renderContentScraperSelect = (
    value: ContentScraper,
    onValueChange: (value: ContentScraper) => void
  ) => (
    <div className="space-y-3">
      <SettingsFormField
        focusId="content-scraper"
        label={
          <>
            <FileText className="icon-md" />
            {t("settings.content_extraction.scraper.label")}
          </>
        }
        labelClassName="font-medium">
        <div className="grid gap-3 min-w-0">
          {CONTENT_SCRAPER_OPTIONS.map((option) => {
            const Icon = getScraperIcon(option.value)
            const isSelected = value === option.value
            return (
              <Button
                key={option.value}
                type="button"
                onClick={() => onValueChange(option.value)}
                className={cn(
                  "group relative flex items-start gap-3 h-auto w-full min-w-0 shrink p-4 text-left whitespace-normal transition-all hover:border-accent-foreground/20 hover:bg-accent/50",
                  isSelected
                    ? "border-primary bg-primary/10 text-primary ring-1 ring-primary"
                    : "border-border bg-accent/30 text-accent-foreground shadow-xs"
                )}>
                <span
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-control transition-colors",
                    isSelected
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted group-hover:bg-muted/80"
                  )}>
                  <Icon className="icon-lg" />
                </span>
                <span className="flex-1 space-y-1.5 min-w-0">
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">
                      {t(
                        `settings.content_extraction.scraper.${option.value}.label`
                      )}
                    </span>
                    {option.recommended && (
                      <Badge
                        variant="default"
                        className="text-micro h-5 px-1.5 font-medium">
                        {t("settings.content_extraction.badges.recommended")}
                      </Badge>
                    )}
                    {isSelected && (
                      <Badge
                        variant="secondary"
                        className="text-micro h-5 px-1.5">
                        {t("settings.content_extraction.badges.active")}
                      </Badge>
                    )}
                  </span>
                  <span className="block text-xs font-medium text-foreground/80">
                    {t(
                      `settings.content_extraction.scraper.${option.value}.description`
                    )}
                  </span>
                  <span className="block text-xs text-muted-foreground leading-relaxed">
                    {t(
                      `settings.content_extraction.scraper.${option.value}.detail`
                    )}
                  </span>
                </span>
              </Button>
            )
          })}
        </div>
      </SettingsFormField>
    </div>
  )

  return (
    <SettingsCard
      icon={Sparkles}
      title={t("settings.content_extraction.title")}
      description={t("settings.content_extraction.description")}
      badge="Beta">
      {/* Enable/Disable Toggle */}
      <SettingsSwitch
        id="content-extraction-enabled"
        label={t("settings.content_extraction.enable.label")}
        description={t("settings.content_extraction.enable.description")}
        checked={config.enabled}
        onCheckedChange={(checked) => onUpdate({ enabled: checked })}
      />

      <SettingsLevelGate settingId="selection-actions-enabled">
        <SettingsSwitch
          id="selection-actions-enabled"
          label={t("settings.content_extraction.selection_actions.label")}
          description={t(
            "settings.content_extraction.selection_actions.description"
          )}
          checked={config.selectionActionsEnabled}
          onCheckedChange={(checked) =>
            onUpdate({
              selectionActionsEnabled: checked,
              showSelectionButton: checked
            })
          }
        />

        <SettingsFormField
          focusId="selection-actions-min-chars"
          label={t(
            "settings.content_extraction.selection_actions_min_chars.label"
          )}
          description={t(
            "settings.content_extraction.selection_actions_min_chars.description"
          )}>
          <Input
            type="number"
            min={1}
            max={500}
            value={
              config.selectionActionsMinChars ??
              DEFAULT_CONTENT_EXTRACTION_CONFIG.selectionActionsMinChars
            }
            onChange={(event) =>
              onUpdate({
                selectionActionsMinChars: Math.max(
                  1,
                  Number(event.target.value) || 1
                )
              })
            }
          />
        </SettingsFormField>

        <SettingsFormField
          label={t("settings.content_extraction.selection_actions_list.label")}
          description={t(
            "settings.content_extraction.selection_actions_list.description"
          )}>
          <div className="grid gap-2 sm:grid-cols-2">
            {SELECTION_ACTIONS.map((action) => {
              const enabledIds =
                config.selectionActionsEnabledIds ??
                DEFAULT_CONTENT_EXTRACTION_CONFIG.selectionActionsEnabledIds
              const checked = enabledIds.includes(action.id)
              return (
                <label
                  key={action.id}
                  className="flex items-center gap-2 rounded-control border border-border px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      const next = event.target.checked
                        ? [...new Set([...enabledIds, action.id])]
                        : enabledIds.filter((id) => id !== action.id)
                      onUpdate({
                        selectionActionsEnabledIds:
                          next.length > 0 ? next : [SELECTION_ACTIONS[0].id]
                      })
                    }}
                  />
                  <span>{action.label}</span>
                </label>
              )
            })}
          </div>
        </SettingsFormField>
      </SettingsLevelGate>

      <SettingsLevelGate settingId="content-scraper">
        <Separator />
        {renderContentScraperSelect(config.contentScraper, (value) =>
          onUpdate({ contentScraper: value })
        )}
      </SettingsLevelGate>

      <SettingsLevelGate settingId="scroll-strategy">
        <Separator />
        <ScrollStrategyField
          value={config.scrollStrategy}
          onValueChange={(value) => onUpdate({ scrollStrategy: value })}
          focusId="scroll-strategy"
          label={
            <>
              <Target className="icon-md" />
              {t("settings.content_extraction.scroll_strategy.label")}
            </>
          }
          description={t(
            `settings.content_extraction.scroll_strategy.${config.scrollStrategy}`
          )}
        />

        <ScrollDepthField
          depth={config.scrollDepth}
          onValueChange={(value) => onUpdate({ scrollDepth: value })}
          focusId="scroll-depth"
          label={
            <>
              <Zap className="icon-md" />
              {t("settings.content_extraction.scroll_depth.label")}
            </>
          }
          description={t(
            "settings.content_extraction.scroll_depth.description"
          )}
        />

        <AdvancedSection
          title={t("settings.content_extraction.timeout.section_title")}
          summary={TIMEOUT_FIELDS.map(
            (field) => `${field.label}: ${config[field.name]}`
          ).join(" · ")}>
          <FormGrid>
            {TIMEOUT_FIELDS.map((field) => (
              <TimeoutInputField
                key={field.id}
                field={field}
                value={config[field.name]}
                onValueChange={(value) => onUpdate({ [field.name]: value })}
                focusId={field.id}
                label={t(
                  `settings.content_extraction.timeout.${field.id.replace(/-/g, "_")}`
                )}
                inputClassName="text-center"
              />
            ))}
          </FormGrid>
        </AdvancedSection>
      </SettingsLevelGate>
    </SettingsCard>
  )
}
