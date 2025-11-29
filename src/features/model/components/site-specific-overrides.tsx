import { useEffect, useState } from "react"
import { Trans, useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { Slider } from "@/components/ui/slider"
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
import type { ContentExtractionConfig, ScrollStrategy } from "@/types"
import { TIMEOUT_FIELDS } from "./content-extraction-constants"

// Scroll strategy options (simplified for site-specific)
const SCROLL_STRATEGY_OPTIONS = SCROLL_STRATEGY_OPTIONS_SHORT

interface SiteSpecificOverridesProps {
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
    <div className="space-y-2">
      <Label className="text-xs flex items-center gap-1.5">
        <field.icon className="h-3 w-3" />
        {field.label}
      </Label>
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
    </div>
  )

  // Render scroll strategy select
  const renderScrollStrategySelect = (
    value: ScrollStrategy,
    onValueChange: (value: ScrollStrategy) => void,
    _id?: string,
    className?: string
  ) => (
    <div className="space-y-2">
      <Label className="text-xs">
        {t("model.site_overrides.scroll_strategy_label")}
      </Label>
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
    </div>
  )

  // Render scroll depth slider
  const renderScrollDepthSlider = (
    depth: number,
    onValueChange: (value: number) => void,
    _id?: string
  ) => {
    const depthPercent = Math.round(depth * 100)
    return (
      <div className="space-y-2">
        <Label className="text-xs">
          {t("model.site_overrides.scroll_depth_label")}
        </Label>
        <div className="space-y-2">
          <Slider
            min={0}
            max={100}
            step={5}
            value={[depthPercent]}
            onValueChange={([value]) => onValueChange(value / 100)}
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>0%</span>
            <Badge variant="outline" className="font-mono text-xs">
              {depthPercent}%
            </Badge>
            <span>100%</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <Target className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-lg">
            {t("model.site_overrides.title")}
          </CardTitle>
        </div>
        <CardDescription className="text-sm">
          {t("model.site_overrides.description")}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-muted-foreground" />
            <Label htmlFor="site-pattern" className="text-sm font-medium">
              {t("model.site_overrides.add_pattern_label")}
            </Label>
          </div>

          <div className="space-y-2">
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  id="site-pattern"
                  value={newSitePattern}
                  onChange={(e) => {
                    setNewSitePattern(e.target.value)
                    if (sitePatternError) setSitePatternError("")
                  }}
                  placeholder={t("model.site_overrides.pattern_placeholder")}
                  className={`h-9 font-mono text-sm ${sitePatternError ? "border-destructive" : ""}`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      handleAddSiteOverride()
                    }
                  }}
                />
                {sitePatternError && (
                  <div className="mt-1 flex items-center gap-1 text-xs text-destructive">
                    <AlertCircle className="h-3 w-3" />
                    {sitePatternError}
                  </div>
                )}
              </div>
              <Button
                onClick={handleAddSiteOverride}
                size="sm"
                className="h-9 whitespace-nowrap px-3"
                disabled={!newSitePattern.trim()}>
                <Plus className="mr-1 h-3 w-3" />
                {t("model.site_overrides.add_button")}
              </Button>
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            <Trans
              i18nKey="model.site_overrides.examples"
              components={[
                <code key="code" className="rounded bg-muted px-1" />
              ]}
            />
          </div>
        </div>

        {Object.keys(config.siteOverrides).length > 0 ? (
          <div className="space-y-4">
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
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                {t("model.site_overrides.select_site_label")}
              </Label>
              <Popover
                open={siteOverrideOpen}
                onOpenChange={setSiteOverrideOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between">
                    <span className="truncate font-mono text-sm">
                      {selectedSiteOverride ||
                        t("model.site_overrides.select_placeholder")}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-[var(--radix-popover-trigger-width)] p-0"
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
                              className={`mr-2 h-4 w-4 ${
                                selectedSiteOverride === pattern
                                  ? "opacity-100"
                                  : "opacity-0"
                              }`}
                            />
                            <code className="font-mono text-sm">{pattern}</code>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

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
                        className="h-8 w-8 p-0"
                        onClick={() => {
                          onRemoveSiteOverride(selectedSiteOverride)
                          const remaining = Object.keys(
                            config.siteOverrides
                          ).filter((p) => p !== selectedSiteOverride)
                          setSelectedSiteOverride(
                            remaining.length > 0 ? remaining[0] : null
                          )
                        }}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {(() => {
                      const override =
                        config.siteOverrides[selectedSiteOverride]
                      return (
                        <>
                          <div className="grid gap-4 md:grid-cols-2">
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
                          </div>
                          <Separator />
                          <div className="grid gap-4 md:grid-cols-2">
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
                          </div>
                        </>
                      )
                    })()}
                  </CardContent>
                </Card>
              )}
          </div>
        ) : (
          <div className="py-6 text-center text-muted-foreground">
            <Target className="mx-auto mb-2 h-8 w-8 opacity-50" />
            <p className="text-sm">{t("model.site_overrides.no_overrides")}</p>
            <p className="text-xs">
              {t("model.site_overrides.no_overrides_hint")}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
