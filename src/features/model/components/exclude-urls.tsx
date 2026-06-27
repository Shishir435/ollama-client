import { useState } from "react"
import { Trans, useTranslation } from "react-i18next"

import {
  SettingsActionRow,
  SettingsCard,
  SettingsFormField
} from "@/components/settings"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { DEFAULT_EXCLUDE_URLS } from "@/lib/constants"
import { AlertCircle, Globe, Plus, Shield, Trash2 } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

export interface ExcludedUrlsProps {
  patterns: string[]
  onAdd: (pattern: string) => void
  onRemove: (pattern: string) => void
}

export const ExcludedUrls = ({
  patterns,
  onAdd,
  onRemove
}: ExcludedUrlsProps) => {
  const { t } = useTranslation()
  const [input, setInput] = useState("")
  const [error, setError] = useState("")

  const handleAdd = () => {
    const trimmed = input.trim()
    if (!trimmed) {
      setError(t("model.exclude_urls.pattern_empty_error"))
      return
    }
    try {
      new RegExp(trimmed)
      if (!patterns.includes(trimmed)) {
        onAdd(trimmed)
        setInput("")
        setError("")
      } else {
        setError(t("model.exclude_urls.pattern_exists_error"))
      }
    } catch {
      setError(t("model.exclude_urls.pattern_invalid_error"))
    }
  }

  const handleRemove = (pattern: string) => {
    if (DEFAULT_EXCLUDE_URLS.includes(pattern)) return
    onRemove(pattern)
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value)
    if (error) setError("")
  }

  const isDefaultPattern = (pattern: string) =>
    DEFAULT_EXCLUDE_URLS.includes(pattern)

  return (
    <SettingsCard
      icon={Shield}
      title={t("model.exclude_urls.title")}
      description={t("model.exclude_urls.description")}
      contentClassName="space-y-5">
      <SettingsFormField
        label={
          <div className="flex items-center gap-2">
            <Globe className="icon-md text-muted-foreground" />
            {t("model.exclude_urls.add_pattern_label")}
          </div>
        }
        description={
          <Trans
            i18nKey="model.exclude_urls.examples"
            components={[<code key="code" className="rounded bg-muted px-1" />]}
          />
        }>
        <SettingsActionRow>
          <div className="flex-1">
            <Input
              id="exclude-url"
              value={input}
              onChange={handleInputChange}
              placeholder={t("model.exclude_urls.pattern_placeholder")}
              className={cn(
                "h-9 font-mono text-sm",
                error && "border-destructive"
              )}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  handleAdd()
                }
              }}
            />
            {error && (
              <div className="mt-1 flex items-center gap-1 text-xs text-destructive">
                <AlertCircle className="icon-xs" />
                {error}
              </div>
            )}
          </div>
          <Button
            onClick={handleAdd}
            size="sm"
            className="h-9 whitespace-nowrap px-3"
            disabled={!input.trim()}>
            <Plus className="mr-1 icon-xs" />
            {t("model.exclude_urls.add_button")}
          </Button>
        </SettingsActionRow>
      </SettingsFormField>

      {patterns.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">
              {t("model.exclude_urls.active_patterns")}
            </h4>
            <Badge variant="secondary" className="text-xs">
              {patterns.length === 1
                ? t("model.exclude_urls.pattern_count", {
                    count: patterns.length
                  })
                : t("model.exclude_urls.pattern_count_plural", {
                    count: patterns.length
                  })}
            </Badge>
          </div>

          <div className="space-y-2">
            {patterns.map((pattern) => (
              <Card
                key={pattern}
                className="group flex-row items-center justify-between bg-sidebar-accent gap-3 ring-0 p-3 transition-colors hover:bg-accent/50">
                <div className="flex items-start gap-2 min-w-0 flex-1">
                  <code className="truncate bg-muted px-1.5 py-0.5 font-mono text-xs">
                    {pattern}
                  </code>
                  {isDefaultPattern(pattern) && (
                    <Badge variant="outline" className="text-xs shrink-0">
                      {t("model.exclude_urls.default_badge")}
                    </Badge>
                  )}
                </div>

                {!isDefaultPattern(pattern) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="size-8 p-0 opacity-60 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                    onClick={() => handleRemove(pattern)}>
                    <Trash2 className="icon-xs" />
                  </Button>
                )}
              </Card>
            ))}
          </div>
        </div>
      ) : (
        <div className="py-6 text-center text-muted-foreground">
          <Shield className="mx-auto mb-2 icon-3xl opacity-50" />
          <p className="text-sm">{t("model.exclude_urls.no_patterns")}</p>
        </div>
      )}
    </SettingsCard>
  )
}
