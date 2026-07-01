import { useEffect, useState } from "react"
import { Trans, useTranslation } from "react-i18next"
import { EmptyState } from "@/components/feedback"
import { FieldStack, FormGrid } from "@/components/layout"
import {
  SettingsActionRow,
  SettingsCard,
  SettingsFormField
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
import {
  ScrollDepthField,
  ScrollStrategyField,
  TimeoutInputField
} from "@/features/model/components/content-extraction-fields"
import {
  AlertCircle,
  Check,
  ChevronsUpDown,
  Globe,
  Plus,
  Target,
  Trash2
} from "@/lib/lucide-icon"
import type { PerSiteProfile, PerSiteRuleMode } from "@/lib/per-site-profiles"
import { cn } from "@/lib/utils"
import type { ContentExtractionConfig } from "@/types"
import { TIMEOUT_FIELDS } from "./content-extraction-constants"

export interface SiteSpecificOverridesProps {
  config: ContentExtractionConfig
  perSiteProfiles: PerSiteProfile[]
  onAddSiteOverride: (pattern: string) => void
  onRemoveSiteOverride: (pattern: string) => void
  onUpdateSiteOverride: (
    pattern: string,
    updates: Partial<ContentExtractionConfig>
  ) => void
  onUpdateSiteProfile: (
    pattern: string,
    updates: Partial<Pick<PerSiteProfile, "tabContext" | "groundedOnly">>
  ) => void
}

export const SiteSpecificOverrides = ({
  config,
  perSiteProfiles,
  onAddSiteOverride,
  onRemoveSiteOverride,
  onUpdateSiteOverride,
  onUpdateSiteProfile
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

  const renderContextRuleSelect = (
    value: PerSiteRuleMode,
    onValueChange: (value: PerSiteRuleMode) => void,
    label: string
  ) => (
    <SettingsFormField label={label} labelClassName="text-xs">
      <Select
        value={value}
        onValueChange={(next) => {
          if (next !== null) onValueChange(next as PerSiteRuleMode)
        }}>
        <SelectTrigger className="h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(["inherit", "always", "never"] as PerSiteRuleMode[]).map((mode) => (
            <SelectItem key={mode} value={mode}>
              {t(`settings.permissions.siteProfiles.modes.${mode}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsFormField>
  )

  return (
    <SettingsCard
      focusId="site-overrides"
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
                    const profile = perSiteProfiles.find(
                      (item) => item.pattern === selectedSiteOverride
                    )
                    return (
                      <>
                        <FormGrid>
                          <ScrollStrategyField
                            value={
                              override.scrollStrategy || config.scrollStrategy
                            }
                            onValueChange={(value) =>
                              onUpdateSiteOverride(selectedSiteOverride, {
                                scrollStrategy: value
                              })
                            }
                            id={`site-${selectedSiteOverride}-strategy`}
                            label={t(
                              "model.site_overrides.scroll_strategy_label"
                            )}
                            labelClassName="text-xs"
                            compact
                            triggerClassName="h-9"
                          />
                          <ScrollDepthField
                            depth={override.scrollDepth ?? config.scrollDepth}
                            onValueChange={(value) =>
                              onUpdateSiteOverride(selectedSiteOverride, {
                                scrollDepth: value
                              })
                            }
                            label={t("model.site_overrides.scroll_depth_label")}
                          />
                        </FormGrid>
                        <Separator />
                        <FormGrid>
                          {renderContextRuleSelect(
                            profile?.tabContext ?? "inherit",
                            (value) =>
                              onUpdateSiteProfile(selectedSiteOverride, {
                                tabContext: value
                              }),
                            t(
                              "settings.permissions.siteProfiles.fields.tabContext"
                            )
                          )}
                          {renderContextRuleSelect(
                            profile?.groundedOnly ?? "inherit",
                            (value) =>
                              onUpdateSiteProfile(selectedSiteOverride, {
                                groundedOnly: value
                              }),
                            t(
                              "settings.permissions.siteProfiles.fields.groundedOnly"
                            )
                          )}
                        </FormGrid>
                        <Separator />
                        <FormGrid>
                          {TIMEOUT_FIELDS.map((field) => (
                            <TimeoutInputField
                              key={field.id}
                              field={field}
                              value={override[field.name] ?? config[field.name]}
                              onValueChange={(value) =>
                                onUpdateSiteOverride(selectedSiteOverride, {
                                  [field.name]: value
                                })
                              }
                              id={`site-${selectedSiteOverride}-${field.id}`}
                              label={field.label}
                              labelClassName="text-xs"
                              inputClassName="h-9 text-center"
                            />
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
