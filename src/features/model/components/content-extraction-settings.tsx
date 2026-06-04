import { useStorage } from "@plasmohq/storage/hook"
import { useTranslation } from "react-i18next"
import { FormGrid, SectionStack } from "@/components/layout"
import {
  SettingsCard,
  SettingsField,
  SettingsSliderField,
  SettingsSwitch
} from "@/components/settings"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { ExcludedUrls } from "@/features/model/components/exclude-urls"
import { SiteSpecificOverrides } from "@/features/model/components/site-specific-overrides"
import { SELECTION_ACTIONS } from "@/features/selection-actions/actions"
import {
  DEFAULT_CONTENT_EXTRACTION_CONFIG,
  STORAGE_KEYS
} from "@/lib/constants"
import {
  CONTENT_SCRAPER_OPTIONS,
  SCROLL_STRATEGY_OPTIONS
} from "@/lib/constants-ui"
import {
  BookOpen,
  Code,
  FileText,
  Sparkles,
  Target,
  Zap
} from "@/lib/lucide-icon"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { cn } from "@/lib/utils"
import type {
  ContentExtractionConfig,
  ContentScraper,
  ScrollStrategy
} from "@/types"
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

  if (!config) {
    return null
  }

  const handleUpdate = (updates: Partial<ContentExtractionConfig>) => {
    setConfig((prev) => ({ ...prev, ...updates }))
  }

  // Handler for adding site-specific override
  const handleAddSiteOverride = (pattern: string) => {
    setConfig((prev) => ({
      ...prev,
      siteOverrides: {
        ...prev.siteOverrides,
        [pattern]: {}
      }
    }))
  }

  // Handler for removing site-specific override
  const handleRemoveSiteOverride = (pattern: string) => {
    setConfig((prev) => {
      const { [pattern]: _, ...remaining } = prev.siteOverrides
      return { ...prev, siteOverrides: remaining }
    })
  }

  // Handler for updating site-specific override
  const handleUpdateSiteOverride = (
    pattern: string,
    updates: Partial<ContentExtractionConfig>
  ) => {
    setConfig((prev) => ({
      ...prev,
      siteOverrides: {
        ...prev.siteOverrides,
        [pattern]: {
          ...prev.siteOverrides[pattern],
          ...updates
        }
      }
    }))
  }

  // Handler for adding excluded URL pattern
  const handleAddExcludedUrl = (pattern: string) => {
    setConfig((prev) => ({
      ...prev,
      excludedUrlPatterns: [...(prev.excludedUrlPatterns || []), pattern]
    }))
  }

  // Handler for removing excluded URL pattern
  const handleRemoveExcludedUrl = (pattern: string) => {
    setConfig((prev) => ({
      ...prev,
      excludedUrlPatterns: (prev.excludedUrlPatterns || []).filter(
        (p) => p !== pattern
      )
    }))
  }

  return (
    <SectionStack>
      <ContentExtractionSettingsForm config={config} onUpdate={handleUpdate} />

      <SiteSpecificOverrides
        config={config}
        onAddSiteOverride={handleAddSiteOverride}
        onRemoveSiteOverride={handleRemoveSiteOverride}
        onUpdateSiteOverride={handleUpdateSiteOverride}
      />

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

  // Render timeout input field
  const renderTimeoutInput = (
    field: (typeof TIMEOUT_FIELDS)[number],
    value: number,
    onChange: (value: number) => void,
    className?: string
  ) => (
    <SettingsField
      key={field.id}
      htmlFor={field.id}
      label={
        <>
          <field.icon className="size-3" />
          {t(
            `settings.content_extraction.timeout.${field.id.replace(/-/g, "_")}`
          )}
        </>
      }
      className={className}>
      <Input
        id={field.id}
        type="number"
        min={field.min}
        max={field.max}
        step={field.step}
        value={value}
        onChange={(e) => {
          const numValue = parseInt(e.target.value, 10) || field.min
          onChange(Math.max(field.min, Math.min(field.max, numValue)))
        }}
        className={className || "text-center"}
      />
    </SettingsField>
  )

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
      <SettingsField
        label={
          <>
            <FileText className="size-4" />
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
                    "flex size-10 shrink-0 items-center justify-center rounded-md transition-colors",
                    isSelected
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted group-hover:bg-muted/80"
                  )}>
                  <Icon className="size-5" />
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
                        className="text-[10px] h-5 px-1.5 font-medium">
                        {t("settings.content_extraction.badges.recommended")}
                      </Badge>
                    )}
                    {isSelected && (
                      <Badge
                        variant="secondary"
                        className="text-[10px] h-5 px-1.5">
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
      </SettingsField>
    </div>
  )

  // Render scroll strategy select
  const renderScrollStrategySelect = (
    value: ScrollStrategy,
    onValueChange: (value: ScrollStrategy) => void,
    id?: string,
    className?: string
  ) => (
    <SettingsField
      htmlFor={id || "scroll-strategy"}
      label={
        <>
          <Target className="size-4" />
          {t("settings.content_extraction.scroll_strategy.label")}
        </>
      }
      description={t(`settings.content_extraction.scroll_strategy.${value}`)}>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger id={id || "scroll-strategy"} className={className}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SCROLL_STRATEGY_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {t(
                `settings.content_extraction.scroll_strategy.options.${option.value}`
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsField>
  )

  // Render scroll depth slider
  const renderScrollDepthSlider = (
    depth: number,
    onValueChange: (value: number) => void,
    _id?: string
  ) => {
    const depthPercent = Math.round(depth * 100)
    return (
      <SettingsSliderField
        label={
          <>
            <Zap className="size-4" />
            {t("settings.content_extraction.scroll_depth.label")}
          </>
        }
        description={t("settings.content_extraction.scroll_depth.description")}
        value={depthPercent}
        valueLabel={`${depthPercent}%`}
        min={0}
        max={100}
        step={5}
        onValueChange={(value) => onValueChange(value / 100)}
        leftLabel="0%"
        rightLabel="100%"
      />
    )
  }

  return (
    <SettingsCard
      icon={Sparkles}
      title={t("settings.content_extraction.title")}
      description={t("settings.content_extraction.description")}
      badge="Beta">
      {/* Enable/Disable Toggle */}
      <SettingsSwitch
        id="enabled"
        label={t("settings.content_extraction.enable.label")}
        description={t("settings.content_extraction.enable.description")}
        checked={config.enabled}
        onCheckedChange={(checked) => onUpdate({ enabled: checked })}
      />

      <SettingsSwitch
        id="selection-actions-enabled"
        label="Enable Selection Actions"
        description="Show local AI actions when text is selected on a page."
        checked={config.selectionActionsEnabled}
        onCheckedChange={(checked) =>
          onUpdate({ selectionActionsEnabled: checked })
        }
      />

      <SettingsField
        label="Minimum selected characters"
        description="Selections shorter than this stay hidden.">
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
      </SettingsField>

      <SettingsField
        label="Selection action list"
        description="Choose which local text actions appear in the page toolbar.">
        <div className="grid gap-2 sm:grid-cols-2">
          {SELECTION_ACTIONS.map((action) => {
            const enabledIds =
              config.selectionActionsEnabledIds ??
              DEFAULT_CONTENT_EXTRACTION_CONFIG.selectionActionsEnabledIds
            const checked = enabledIds.includes(action.id)
            return (
              <label
                key={action.id}
                className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
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
      </SettingsField>

      <Separator />

      {/* Content Scraper Selection */}
      {renderContentScraperSelect(config.contentScraper, (value) =>
        onUpdate({ contentScraper: value })
      )}

      <Separator />

      {/* Scroll Strategy */}
      {renderScrollStrategySelect(config.scrollStrategy, (value) =>
        onUpdate({ scrollStrategy: value })
      )}

      {/* Scroll Depth */}
      {renderScrollDepthSlider(config.scrollDepth, (value) =>
        onUpdate({ scrollDepth: value })
      )}

      {/* Advanced Settings Grid */}
      <FormGrid>
        {TIMEOUT_FIELDS.map((field) => (
          <div key={field.id}>
            {renderTimeoutInput(
              field,
              config[field.name],
              (value) => onUpdate({ [field.name]: value }),
              "text-center"
            )}
          </div>
        ))}
      </FormGrid>
    </SettingsCard>
  )
}
