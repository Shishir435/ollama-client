import { useEffect, useState } from "react"
import { Trans, useTranslation } from "react-i18next"
import { EmptyState } from "@/components/feedback"
import { FieldStack, FormGrid } from "@/components/layout"
import {
  SettingsActionRow,
  SettingsCard,
  SettingsFormField,
  SettingsSliderField
} from "@/components/settings"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { SCROLL_STRATEGY_OPTIONS_SHORT } from "@/lib/constants-ui"
import {
  AlertCircle,
  Check,
  ChevronsUpDown,
  Globe,
  Plus,
  Target,
  Trash2
} from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"
import type { ContentExtractionConfig, ScrollStrategy } from "@/types"
import { TIMEOUT_FIELDS } from "./content-extraction-constants"

// Scroll strategy options (simplified for site-specific)
const SCROLL_STRATEGY_OPTIONS = SCROLL_STRATEGY_OPTIONS_SHORT

export interface SiteSpecificOverridesProps {
  config: ContentExtractionConfig
  onAddSiteOverride: (pattern: string) => void
  onRemoveSiteOverride: (pattern: string) => void
  onUpdateSiteOverride: (
    pattern: string,
    updates: Partial<ContentExtractionConfig>
  ) => void
}

export const SiteSpecificOverrides = ({
  config,
  onAddSiteOverride,
  onRemoveSiteOverride,
  onUpdateSiteOverride
}: SiteSpecificOverridesProps) => {
  const { t } = useTranslation()
  const [newSitePattern, setNewSitePattern] = useState("")
  const [sitePatternError, setSitePatternError] = useState("")
  const [selectedSiteOverride, setSelectedSiteOverride] = useState<
    string | null
  >(null)
  const [siteOverrideOpen, setSiteOverrideOpen] = useState(false)

  const handleAddSiteOverride = () => {
    const trimmed = newSitePattern.trim()
    if (!trimmed) {
      setSitePatternError(t("model.site_overrides.pattern_empty_error"))
      return
    }
    try {
      new RegExp(trimmed)
      if (!config.siteOverrides[trimmed]) {
        onAddSiteOverride(trimmed)
        setNewSitePattern("")
        setSitePatternError("")
        // Auto-select the newly added site
        setSelectedSiteOverride(trimmed)
        setSiteOverrideOpen(false)
      } else {
        setSitePatternError(t("model.site_overrides.pattern_exists_error"))
      }
    } catch {
      setSitePatternError(t("model.site_overrides.pattern_invalid_error"))
    }
  }

  // Auto-select first site override if none selected and there are overrides
  useEffect(() => {
    const siteKeys = Object.keys(config.siteOverrides)
    if (siteKeys.length > 0 && !selectedSiteOverride) {
      setSelectedSiteOverride(siteKeys[0])
    } else if (siteKeys.length === 0) {
      setSelectedSiteOverride(null)
    }
  }, [config.siteOverrides, selectedSiteOverride])

  // Render timeout input field
  const renderTimeoutInput = (
    field: (typeof TIMEOUT_FIELDS)[number],
    value: number,
    onChange: (value: number) => void,
    className?: string
  ) => (
    <SettingsFormField
      key={field.id}
      label={
        <div className="flex items-center gap-1.5">
          <field.icon className="icon-xs" />
          {field.label}
        </div>
      }
      labelClassName="text-xs">
      <Input
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

  // Render scroll strategy select
  const renderScrollStrategySelect = (
    value: ScrollStrategy,
    onValueChange: (value: ScrollStrategy) => void,
    _id?: string,
    className?: string
  ) => (
    <SettingsFormField
      label={t("model.site_overrides.scroll_strategy_label")}
      labelClassName="text-xs">
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className={className || "h-9"}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SCROLL_STRATEGY_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {t(
                `settings.content_extraction.scroll_strategy.options_short.${option.value}`
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
    _id?: string
  ) => {
    const depthPercent = Math.round(depth * 100)
    return (
      <SettingsSliderField
        label={t("model.site_overrides.scroll_depth_label")}
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
      icon={Target}
      title={t("model.site_overrides.title")}
      description={t("model.site_overrides.description")}
      contentClassName="space-y-5"
      headerClassName="pb-4">
      <SettingsFormField
        label={
          <div className="flex items-center gap-2">
            <Globe className="icon-md text-muted-foreground" />
            {t("model.site_overrides.add_pattern_label")}
          </div>
        }
        description={
          <Trans
            i18nKey="model.site_overrides.examples"
            components={[<code key="code" className="rounded bg-muted px-1" />]}
          />
        }>
        <SettingsActionRow>
          <div className="flex-1">
            <Input
              id="site-pattern"
              value={newSitePattern}
              onChange={(e) => {
                setNewSitePattern(e.target.value)
                if (sitePatternError) setSitePatternError("")
              }}
              placeholder={t("model.site_overrides.pattern_placeholder")}
              className={cn(
                "h-9 font-mono text-sm",
                sitePatternError && "border-destructive"
              )}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  handleAddSiteOverride()
                }
              }}
            />
            {sitePatternError && (
              <div className="mt-1 flex items-center gap-1 text-xs text-destructive">
                <AlertCircle className="icon-xs" />
                {sitePatternError}
              </div>
            )}
          </div>
          <Button
            onClick={handleAddSiteOverride}
            size="sm"
            className="h-9 whitespace-nowrap px-3"
            disabled={!newSitePattern.trim()}>
            <Plus className="mr-1 icon-xs" />
            {t("model.site_overrides.add_button")}
          </Button>
        </SettingsActionRow>
      </SettingsFormField>

      {Object.keys(config.siteOverrides).length > 0 ? (
        <FieldStack>
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">
              {t("model.site_overrides.active_overrides")}
            </h4>
            <Badge variant="secondary" className="text-xs">
              {Object.keys(config.siteOverrides).length === 1
                ? t("model.site_overrides.site_count", {
                    count: Object.keys(config.siteOverrides).length
                  })
                : t("model.site_overrides.site_count_plural", {
                    count: Object.keys(config.siteOverrides).length
                  })}
            </Badge>
          </div>

          {/* Site Selector Dropdown */}
          <SettingsFormField
            label={t("model.site_overrides.select_site_label")}>
            <Popover open={siteOverrideOpen} onOpenChange={setSiteOverrideOpen}>
              <PopoverTrigger
                render={
                  <Button
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between"
                  />
                }>
                <span className="truncate font-mono text-sm">
                  {selectedSiteOverride ||
                    t("model.site_overrides.select_placeholder")}
                </span>
                <ChevronsUpDown className="ml-2 icon-md shrink-0 opacity-50" />
              </PopoverTrigger>
              <PopoverContent
                className="w-(--radix-popover-trigger-width) p-0"
                align="start">
                <Command>
                  <CommandInput
                    placeholder={t("model.site_overrides.search_placeholder")}
                    className="h-9"
                  />
                  <CommandList>
                    <CommandEmpty>
                      {t("model.site_overrides.no_sites_found")}
                    </CommandEmpty>
                    <CommandGroup>
                      {Object.keys(config.siteOverrides).map((pattern) => (
                        <CommandItem
                          key={pattern}
                          value={pattern}
                          onSelect={() => {
                            setSelectedSiteOverride(pattern)
                            setSiteOverrideOpen(false)
                          }}>
                          <Check
                            className={cn(
                              "mr-2 icon-md",
                              selectedSiteOverride === pattern
                                ? "opacity-100"
                                : "opacity-0"
                            )}
                          />
                          <code className="font-mono text-sm">{pattern}</code>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </SettingsFormField>

          {/* Selected Site Configuration */}
          {selectedSiteOverride &&
            config.siteOverrides[selectedSiteOverride] && (
              <Card className="border-dashed">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <code className="rounded bg-muted px-2 py-1 font-mono text-xs">
                        {selectedSiteOverride}
                      </code>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="size-8 p-0"
                      onClick={() => {
                        onRemoveSiteOverride(selectedSiteOverride)
                        const remaining = Object.keys(
                          config.siteOverrides
                        ).filter((p) => p !== selectedSiteOverride)
                        setSelectedSiteOverride(
                          remaining.length > 0 ? remaining[0] : null
                        )
                      }}>
                      <Trash2 className="icon-xs" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {(() => {
                    const override = config.siteOverrides[selectedSiteOverride]
                    return (
                      <>
                        <FormGrid>
                          {renderScrollStrategySelect(
                            override.scrollStrategy || config.scrollStrategy,
                            (value) =>
                              onUpdateSiteOverride(selectedSiteOverride, {
                                scrollStrategy: value
                              }),
                            `site-${selectedSiteOverride}-strategy`,
                            "h-9"
                          )}
                          {renderScrollDepthSlider(
                            override.scrollDepth ?? config.scrollDepth,
                            (value) =>
                              onUpdateSiteOverride(selectedSiteOverride, {
                                scrollDepth: value
                              }),
                            `site-${selectedSiteOverride}-depth`
                          )}
                        </FormGrid>
                        <Separator />
                        <FormGrid>
                          {TIMEOUT_FIELDS.map((field) => (
                            <div key={field.id}>
                              {renderTimeoutInput(
                                field,
                                override[field.name] ?? config[field.name],
                                (value) =>
                                  onUpdateSiteOverride(selectedSiteOverride, {
                                    [field.name]: value
                                  }),
                                "text-center h-9"
                              )}
                            </div>
                          ))}
                        </FormGrid>
                      </>
                    )
                  })()}
                </CardContent>
              </Card>
            )}
        </FieldStack>
      ) : (
        <EmptyState
          className="min-h-32 py-6"
          icon={Target}
          title={t("model.site_overrides.no_overrides")}
          description={t("model.site_overrides.no_overrides_hint")}
        />
      )}
    </SettingsCard>
  )
}
