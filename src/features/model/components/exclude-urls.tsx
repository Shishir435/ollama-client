import { useState } from "react"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DEFAULT_EXCLUDE_URLS } from "@/lib/constants"
import { AlertCircle, Globe, Plus, Shield, Trash2 } from "@/lib/lucide-icon"

interface ExcludedUrlsProps {
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
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-lg">
            {t("model.exclude_urls.title")}
          </CardTitle>
        </div>
        <CardDescription className="text-sm">
          {t("model.exclude_urls.description")}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-muted-foreground" />
            <Label htmlFor="exclude-url" className="text-sm font-medium">
              {t("model.exclude_urls.add_pattern_label")}
            </Label>
          </div>

          <div className="space-y-2">
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  id="exclude-url"
                  value={input}
                  onChange={handleInputChange}
                  placeholder={t("model.exclude_urls.pattern_placeholder")}
                  className={`h-9 font-mono text-sm ${error ? "border-destructive" : ""}`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      handleAdd()
                    }
                  }}
                />
                {error && (
                  <div className="mt-1 flex items-center gap-1 text-xs text-destructive">
                    <AlertCircle className="h-3 w-3" />
                    {error}
                  </div>
                )}
              </div>
              <Button
                onClick={handleAdd}
                size="sm"
                className="h-9 whitespace-nowrap px-3"
                disabled={!input.trim()}>
                <Plus className="mr-1 h-3 w-3" />
                {t("model.exclude_urls.add_button")}
              </Button>
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            <Trans
              i18nKey="model.exclude_urls.examples"
              components={[
                <code key="code" className="rounded bg-muted px-1" />
              ]}
            />
          </div>
        </div>

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
                <div
                  key={pattern}
                  className="group flex items-center justify-between rounded-lg border bg-card p-3 transition-colors hover:bg-accent/50">
                  <div className="mr-3 min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                        {pattern}
                      </code>
                      {isDefaultPattern(pattern) && (
                        <Badge variant="outline" className="text-xs">
                          {t("model.exclude_urls.default_badge")}
                        </Badge>
                      )}
                    </div>
                  </div>

                  {!isDefaultPattern(pattern) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 opacity-60 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                      onClick={() => handleRemove(pattern)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="py-6 text-center text-muted-foreground">
            <Shield className="mx-auto mb-2 h-8 w-8 opacity-50" />
            <p className="text-sm">{t("model.exclude_urls.no_patterns")}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
