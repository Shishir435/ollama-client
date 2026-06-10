import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { SettingsButton } from "@/components/settings-button"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { PreviewSheet } from "@/features/chat/components"
import { usePromptTemplates } from "@/features/prompt/hooks/use-prompt-templates"
import { logger } from "@/lib/logger"
import {
  Clock,
  Copy,
  Eye,
  Filter,
  Search,
  Star,
  Tag,
  Zap
} from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"
import type { PromptTemplate } from "@/types"

export interface PromptSelectorSheetProps {
  open: boolean
  onSelect: (prompt: string) => void
  onClose: () => void
}

type SortMode = "recent" | "popular" | "alphabetical"

export function PromptSelectorSheet({
  open,
  onSelect,
  onClose
}: PromptSelectorSheetProps) {
  const { t } = useTranslation()
  const { templates, incrementUsageCount } = usePromptTemplates()
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<SortMode>("recent")
  const [previewTemplate, setPreviewTemplate] = useState<PromptTemplate | null>(
    null
  )

  const categories = useMemo(() => {
    const values = new Set(
      templates?.map((template) => template.category).filter(Boolean) || []
    )
    return Array.from(values)
  }, [templates])

  const filteredTemplates = useMemo(() => {
    if (!templates) return []

    const query = searchQuery.trim().toLowerCase()
    const filtered = templates.filter((template) => {
      const matchesSearch =
        !query ||
        template.title.toLowerCase().includes(query) ||
        template.description?.toLowerCase().includes(query) ||
        template.userPrompt.toLowerCase().includes(query) ||
        template.tags?.some((tag) => tag.toLowerCase().includes(query))

      const matchesCategory =
        !selectedCategory || template.category === selectedCategory

      return matchesSearch && matchesCategory
    })

    return filtered.sort((a, b) => {
      if (sortBy === "popular") return (b.usageCount || 0) - (a.usageCount || 0)
      if (sortBy === "alphabetical") return a.title.localeCompare(b.title)
      return (
        (new Date(b.createdAt).getTime() || 0) -
        (new Date(a.createdAt).getTime() || 0)
      )
    })
  }, [templates, searchQuery, selectedCategory, sortBy])

  const handleTemplateSelect = (template: PromptTemplate) => {
    onSelect(template.userPrompt)
    incrementUsageCount(template.id)
  }

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch (err) {
      logger.error("Failed to copy text", "PromptSelectorSheet", {
        error: err
      })
    }
  }

  const cycleSort = () => {
    setSortBy((current) =>
      current === "recent"
        ? "popular"
        : current === "popular"
          ? "alphabetical"
          : "recent"
    )
  }

  return (
    <PreviewSheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
      title={
        <span className="flex min-w-0 items-center justify-between gap-2">
          <span className="truncate">{t("prompts.selector.title")}</span>
          <SettingsButton
            showText={false}
            size="icon"
            className="size-8 rounded-control"
          />
        </span>
      }
      meta={t("prompts.selector.description", {
        count: filteredTemplates.length
      })}
      className="w-[min(34rem,calc(100vw-1rem))]">
      <div className="grid shrink-0 gap-2 border-b border-border/35 p-3">
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2 icon-sm text-muted-foreground" />
            <Input
              placeholder={t("prompts.selector.search_placeholder")}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="h-8 rounded-control pl-7 text-xs"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 shrink-0 gap-1 rounded-control px-2 text-xs"
            onClick={cycleSort}>
            {sortBy === "recent" && <Clock className="icon-sm" />}
            {sortBy === "popular" && <Star className="icon-sm" />}
            {sortBy === "alphabetical" && <Filter className="icon-sm" />}
            <span className="hidden min-[28rem]:inline">
              {sortBy === "recent" && t("prompts.selector.sort_recent")}
              {sortBy === "popular" && t("prompts.selector.sort_popular")}
              {sortBy === "alphabetical" &&
                t("prompts.selector.sort_alphabetical")}
            </span>
          </Button>
        </div>

        {categories.length > 0 && (
          <div className="flex gap-1 overflow-x-auto scrollbar-none">
            <Button
              type="button"
              variant={selectedCategory === null ? "secondary" : "ghost"}
              size="sm"
              className="h-7 shrink-0 rounded-control px-2 text-xs"
              onClick={() => setSelectedCategory(null)}>
              {t("prompts.selector.all_categories")}
            </Button>
            {categories.map((category) => (
              <Button
                key={category}
                type="button"
                variant={selectedCategory === category ? "secondary" : "ghost"}
                size="sm"
                className="h-7 shrink-0 rounded-control px-2 text-xs"
                onClick={() => setSelectedCategory(category)}>
                {category}
              </Button>
            ))}
          </div>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1 overflow-x-hidden">
        <div className="grid gap-2 p-3">
          {filteredTemplates.length === 0 && (
            <div className="grid justify-items-center gap-2 rounded-panel border border-border/35 bg-background/35 p-8 text-center">
              <Search className="size-8 text-muted-foreground/50" />
              <h3 className="text-sm font-semibold">
                {t("prompts.selector.no_templates_title")}
              </h3>
              <p className="max-w-sm text-xs text-muted-foreground">
                {searchQuery || selectedCategory
                  ? t("prompts.selector.no_templates_search")
                  : t("prompts.selector.no_templates_empty")}
              </p>
              {(searchQuery || selectedCategory) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSearchQuery("")
                    setSelectedCategory(null)
                  }}>
                  {t("prompts.selector.clear_filters")}
                </Button>
              )}
            </div>
          )}

          {filteredTemplates.map((template) => {
            const isPreviewed = previewTemplate?.id === template.id
            return (
              <div
                key={template.id}
                className={cn(
                  "rounded-panel border border-border/35 bg-background/35",
                  isPreviewed && "border-primary/40"
                )}>
                <button
                  type="button"
                  className="grid w-full gap-1 p-3 text-left"
                  onClick={() => handleTemplateSelect(template)}>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                      {template.title}
                    </span>
                    {template.category && (
                      <Badge variant="secondary" className="shrink-0 text-xs">
                        {template.category}
                      </Badge>
                    )}
                    {(template.usageCount || 0) > 0 && (
                      <Badge
                        variant="outline"
                        className="shrink-0 gap-1 text-xs">
                        <Zap className="icon-xs" />
                        {template.usageCount}
                      </Badge>
                    )}
                  </span>
                  {template.description && (
                    <span className="line-clamp-2 text-xs text-muted-foreground">
                      {template.description}
                    </span>
                  )}
                  <span className="line-clamp-2 text-xs text-muted-foreground/80">
                    {template.userPrompt}
                  </span>
                </button>
                <div className="flex items-center justify-between border-t border-border/35 px-3 py-2">
                  <div className="flex min-w-0 gap-1">
                    {template.tags?.slice(0, 3).map((tag) => (
                      <Badge key={tag} variant="outline" className="text-xs">
                        <Tag className="mr-1 size-2.5" />
                        {tag}
                      </Badge>
                    ))}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() =>
                        setPreviewTemplate(isPreviewed ? null : template)
                      }
                      aria-label={t("tabs.select.view_content")}>
                      <Eye className="icon-sm" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => copyToClipboard(template.userPrompt)}
                      aria-label={t("prompts.selector.copy")}>
                      <Copy className="icon-sm" />
                    </Button>
                  </div>
                </div>
                {isPreviewed && (
                  <div className="grid gap-3 border-t border-border/35 p-3">
                    {template.systemPrompt && (
                      <PromptPreviewBlock
                        title={t("prompts.selector.preview_system_prompt")}
                        text={template.systemPrompt}
                      />
                    )}
                    <PromptPreviewBlock
                      title={t("prompts.selector.preview_user_prompt")}
                      text={template.userPrompt}
                    />
                    <Button
                      type="button"
                      className="h-8 rounded-control text-xs"
                      onClick={() => handleTemplateSelect(template)}>
                      {t("prompts.selector.use_template")}
                    </Button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </ScrollArea>
    </PreviewSheet>
  )
}

function PromptPreviewBlock({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold text-muted-foreground">
        {title}
      </h4>
      <div className="max-h-48 overflow-y-auto overflow-x-hidden rounded-control border border-border/35 bg-background/45 p-2 text-xs leading-relaxed text-muted-foreground">
        {text}
      </div>
    </div>
  )
}
