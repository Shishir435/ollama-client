import { useStorage } from "@plasmohq/storage/hook"
import { useTranslation } from "react-i18next"
import {
  SettingsCard,
  SettingsFormField,
  SettingsSwitch
} from "@/components/settings"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { ExcludedUrls } from "@/features/model/components/exclude-urls"
import { SelectionButtonToggle } from "@/features/model/components/selection-button-toggle"
import { SiteSpecificOverrides } from "@/features/model/components/site-specific-overrides"
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
import type {
  ContentExtractionConfig,
  ContentScraper,
  ScrollStrategy
} from "@/types"
import { TIMEOUT_FIELDS } from "./content-extraction-constants"

interface ContentExtractionSettingsFormProps {
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
    <div className="space-y-6">
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
    </div>
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
    <SettingsFormField
      key={field.id}
      htmlFor={field.id}
      label={
        <>
          <field.icon className="h-3 w-3" />
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
    </SettingsFormField>
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
      <SettingsFormField
        label={
          <>
            <FileText className="h-4 w-4" />
            {t("settings.content_extraction.scraper.label")}
          </>
        }
        labelClassName="font-medium">
        <div className="grid gap-3">
          {CONTENT_SCRAPER_OPTIONS.map((option) => {
            const Icon = getScraperIcon(option.value)
            const isSelected = value === option.value
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onValueChange(option.value)}
                className={`
                group relative flex items-start gap-3 rounded-lg border p-4 text-left transition-all
                hover:bg-accent/50 hover:border-accent-foreground/20
                ${
                  isSelected
                    ? "border-primary bg-accent/30 ring-1 ring-primary shadow-sm"
                    : "border-border"
                }
              `}>
                <div
                  className={`
                  flex h-10 w-10 shrink-0 items-center justify-center rounded-md transition-colors
                  ${isSelected ? "bg-primary text-primary-foreground" : "bg-muted group-hover:bg-muted/80"}
                `}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex-1 space-y-1.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
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
                  </div>
                  <p className="text-xs font-medium text-foreground/80">
                    {t(
                      `settings.content_extraction.scraper.${option.value}.description`
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {t(
                      `settings.content_extraction.scraper.${option.value}.detail`
                    )}
                  </p>
                </div>
              </button>
            )
          })}
        </div>
      </SettingsFormField>
    </div>
  )

  // Render scroll strategy select
  const renderScrollStrategySelect = (
    value: ScrollStrategy,
    onValueChange: (value: ScrollStrategy) => void,
    id?: string,
    className?: string
  ) => (
    <SettingsFormField
      htmlFor={id || "scroll-strategy"}
      label={
        <>
          <Target className="h-4 w-4" />
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
    </SettingsFormField>
  )

  // Render scroll depth slider
  const renderScrollDepthSlider = (
    depth: number,
    onValueChange: (value: number) => void,
    id?: string
  ) => {
    const depthPercent = Math.round(depth * 100)
    return (
      <SettingsFormField
        htmlFor={id || "scroll-depth"}
        label={
          <>
            <Zap className="h-4 w-4" />
            {t("settings.content_extraction.scroll_depth.label")}
          </>
        }
        description={t("settings.content_extraction.scroll_depth.description")}>
        <Slider
          id={id || "scroll-depth"}
          min={0}
          max={100}
          step={5}
          value={[depthPercent]}
          onValueChange={([value]) => onValueChange(value / 100)}
          className="py-2"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>0%</span>
          <Badge variant="outline" className="font-mono">
            {depthPercent}%
          </Badge>
          <span>100%</span>
        </div>
      </SettingsFormField>
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

      <div className="rounded-lg border bg-card p-4">
        <SettingsFormField
          htmlFor="show-selection-button"
          label={t("settings.content_extraction.selection_button.label")}
          description={t(
            "settings.content_extraction.selection_button.description"
          )}
          className="flex items-center justify-between space-y-0"
          labelClassName="flex-col items-start gap-1">
          <SelectionButtonToggle />
        </SettingsFormField>
      </div>

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
      <div className="grid gap-4 md:grid-cols-2">
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
      </div>
    </SettingsCard>
  )
}
