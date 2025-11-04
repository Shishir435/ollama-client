import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import {
  CONTENT_SCRAPER_OPTIONS,
  SCROLL_STRATEGY_DESCRIPTIONS,
  SCROLL_STRATEGY_OPTIONS
} from "@/lib/constants-ui"
import {
  BookOpen,
  Code,
  FileText,
  Settings,
  Sparkles,
  Target,
  Zap
} from "@/lib/lucide-icon"
import type {
  ContentExtractionConfig,
  ContentScraper,
  ScrollStrategy
} from "@/types"
import { TIMEOUT_FIELDS } from "./content-extraction-constants"

interface GlobalSettingsProps {
  config: ContentExtractionConfig
  onUpdate: (updates: Partial<ContentExtractionConfig>) => void
}

export const GlobalSettings = ({ config, onUpdate }: GlobalSettingsProps) => {
  // Render timeout input field
  const renderTimeoutInput = (
    field: (typeof TIMEOUT_FIELDS)[number],
    value: number,
    onChange: (value: number) => void,
    className?: string
  ) => (
    <div className="space-y-2">
      <Label htmlFor={field.id} className="flex items-center gap-2 text-sm">
        <field.icon className="h-3 w-3" />
        {field.label}
      </Label>
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
    </div>
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
      <Label className="flex items-center gap-2 text-sm font-medium">
        <FileText className="h-4 w-4" />
        Content Scraper
      </Label>
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
                  <span className="font-semibold text-sm">{option.label}</span>
                  {option.recommended && (
                    <Badge
                      variant="default"
                      className="text-[10px] h-5 px-1.5 font-medium">
                      Recommended
                    </Badge>
                  )}
                  {isSelected && (
                    <Badge
                      variant="secondary"
                      className="text-[10px] h-5 px-1.5">
                      Active
                    </Badge>
                  )}
                </div>
                <p className="text-xs font-medium text-foreground/80">
                  {option.description}
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {option.detail}
                </p>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )

  // Render scroll strategy select
  const renderScrollStrategySelect = (
    value: ScrollStrategy,
    onValueChange: (value: ScrollStrategy) => void,
    id?: string,
    className?: string
  ) => (
    <div className="space-y-3">
      <Label
        htmlFor={id || "scroll-strategy"}
        className="flex items-center gap-2">
        <Target className="h-4 w-4" />
        Scroll Strategy
      </Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger id={id || "scroll-strategy"} className={className}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SCROLL_STRATEGY_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        {SCROLL_STRATEGY_DESCRIPTIONS[value]}
      </p>
    </div>
  )

  // Render scroll depth slider
  const renderScrollDepthSlider = (
    depth: number,
    onValueChange: (value: number) => void,
    id?: string
  ) => {
    const depthPercent = Math.round(depth * 100)
    return (
      <div className="space-y-3">
        <Label
          htmlFor={id || "scroll-depth"}
          className="flex items-center gap-2">
          <Zap className="h-4 w-4" />
          Scroll Depth
        </Label>
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
        <p className="text-xs text-muted-foreground">
          Percentage of page to scroll (higher = more content, slower)
        </p>
      </div>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <Settings className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-lg">Global Settings</CardTitle>
        </div>
        <CardDescription className="text-sm">
          Configure default content extraction behavior for all sites
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Enable/Disable Toggle */}
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="space-y-0.5">
            <Label htmlFor="enabled" className="text-base font-medium">
              Enable Content Extraction
            </Label>
            <p className="text-sm text-muted-foreground">
              Enable enhanced content extraction with lazy loading support
            </p>
          </div>
          <Switch
            id="enabled"
            checked={config.enabled}
            onCheckedChange={(checked) => onUpdate({ enabled: checked })}
          />
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
      </CardContent>
    </Card>
  )
}
