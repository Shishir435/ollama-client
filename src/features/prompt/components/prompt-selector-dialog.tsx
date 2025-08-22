import { useMemo, useState } from "react"

import { Clock, Copy, Eye, Filter, Search, Star, Tag, Zap } from "lucide-react"

import { SettingsButton } from "@/components/settings-button"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { usePromptTemplates } from "@/features/prompt/hooks/use-prompt-templates"
import type { PromptTemplate } from "@/types"

interface PromptSelectorDialogProps {
  open: boolean
  onSelect: (prompt: string) => void
  onClose: () => void
}

export const PromptSelectorDialog = ({
  open,
  onSelect,
  onClose
}: PromptSelectorDialogProps) => {
  const { templates, incrementUsageCount } = usePromptTemplates()
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<"recent" | "popular" | "alphabetical">(
    "recent"
  )
  const [previewTemplate, setPreviewTemplate] = useState<PromptTemplate | null>(
    null
  )

  const categories = useMemo(() => {
    const cats = new Set(
      templates?.map((t) => t.category).filter(Boolean) || []
    )
    return Array.from(cats)
  }, [templates])

  const filteredTemplates = useMemo(() => {
    if (!templates) return []

    let filtered = templates.filter((template) => {
      const matchesSearch =
        !searchQuery ||
        template.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        template.description
          ?.toLowerCase()
          .includes(searchQuery.toLowerCase()) ||
        template.userPrompt.toLowerCase().includes(searchQuery.toLowerCase()) ||
        template.tags?.some((tag) =>
          tag.toLowerCase().includes(searchQuery.toLowerCase())
        )

      const matchesCategory =
        !selectedCategory || template.category === selectedCategory

      return matchesSearch && matchesCategory
    })

    filtered.sort((a, b) => {
      switch (sortBy) {
        case "popular":
          return (b.usageCount || 0) - (a.usageCount || 0)
        case "alphabetical":
          return a.title.localeCompare(b.title)
        case "recent":
        default:
          return (
            (new Date(b.createdAt).getTime() || 0) -
            (new Date(a.createdAt).getTime() || 0)
          )
      }
    })

    return filtered
  }, [templates, searchQuery, selectedCategory, sortBy])

  const handleTemplateSelect = (template: PromptTemplate) => {
    onSelect(template.userPrompt)
    incrementUsageCount(template.id)
  }

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch (err) {
      console.error("Failed to copy text: ", err)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
        <DialogContent className="h-[80vh] max-w-4xl p-0">
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle className="mr-6 flex items-center justify-between text-sm font-medium">
              Prompt Templates{" "}
              <div className="-translate-y-2.5">
                <SettingsButton showText={false} />
              </div>
            </DialogTitle>
            <DialogDescription className="mt-1">
              Choose from {filteredTemplates.length} templates to jump start
              your conversation
            </DialogDescription>

            <div className="mt-4 flex gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-muted-foreground" />
                <Input
                  placeholder="Search templates, tags, or descriptions..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setSortBy(
                      sortBy === "recent"
                        ? "popular"
                        : sortBy === "popular"
                          ? "alphabetical"
                          : "recent"
                    )
                  }
                  className="gap-2">
                  {sortBy === "recent" && <Clock className="h-4 w-4" />}
                  {sortBy === "popular" && <Star className="h-4 w-4" />}
                  {sortBy === "alphabetical" && <Filter className="h-4 w-4" />}
                  {sortBy === "recent" && "Recent"}
                  {sortBy === "popular" && "Popular"}
                  {sortBy === "alphabetical" && "A-Z"}
                </Button>
              </div>
            </div>

            {categories.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant={selectedCategory === null ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedCategory(null)}>
                  All Categories
                </Button>
                {categories.map((category) => (
                  <Button
                    key={category}
                    variant={
                      selectedCategory === category ? "default" : "outline"
                    }
                    size="sm"
                    onClick={() => setSelectedCategory(category)}>
                    {category}
                  </Button>
                ))}
              </div>
            )}
          </DialogHeader>

          {filteredTemplates.length > 0 ? (
            <div className="flex h-full min-h-0">
              <ScrollArea className="flex-1 p-6">
                <div className="grid gap-3">
                  {filteredTemplates.map((template) => (
                    <div
                      key={template.id}
                      className="group cursor-pointer rounded-lg border p-4 transition-colors hover:bg-muted/50"
                      onClick={() => handleTemplateSelect(template)}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="mb-2 flex items-center gap-2">
                            <h3 className="truncate text-sm font-semibold">
                              {template.title}
                            </h3>
                            {template.category && (
                              <Badge variant="secondary" className="text-xs">
                                {template.category}
                              </Badge>
                            )}
                            {(template.usageCount || 0) > 0 && (
                              <Badge
                                variant="outline"
                                className="gap-1 text-xs">
                                <Zap className="h-3 w-3" />
                                {template.usageCount}
                              </Badge>
                            )}
                          </div>

                          {template.description && (
                            <p className="mb-2 line-clamp-2 text-xs text-muted-foreground">
                              {template.description}
                            </p>
                          )}

                          <p className="line-clamp-2 text-xs text-muted-foreground/80">
                            {template.userPrompt}
                          </p>

                          {template.tags && template.tags.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {template.tags.slice(0, 3).map((tag) => (
                                <Badge
                                  key={tag}
                                  variant="outline"
                                  className="px-1.5 py-0.5 text-xs">
                                  <Tag className="mr-1 h-2.5 w-2.5" />
                                  {tag}
                                </Badge>
                              ))}
                              {template.tags.length > 3 && (
                                <Badge
                                  variant="outline"
                                  className="px-1.5 py-0.5 text-xs">
                                  +{template.tags.length - 3}
                                </Badge>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              setPreviewTemplate(template)
                            }}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              copyToClipboard(template.userPrompt)
                            }}>
                            <Copy className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center p-12 text-center">
              <Search className="mb-4 h-12 w-12 text-muted-foreground/50" />
              <h3 className="mb-2 text-lg font-semibold">No templates found</h3>
              <p className="max-w-sm text-sm text-muted-foreground">
                {searchQuery || selectedCategory
                  ? "Try adjusting your search or filter criteria"
                  : "No prompt templates are available. Create your first template in settings."}
              </p>
              {(searchQuery || selectedCategory) && (
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => {
                    setSearchQuery("")
                    setSelectedCategory(null)
                  }}>
                  Clear filters
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {previewTemplate && (
        <Dialog
          open={!!previewTemplate}
          onOpenChange={() => setPreviewTemplate(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {previewTemplate.title}
                {previewTemplate.category && (
                  <Badge variant="secondary">{previewTemplate.category}</Badge>
                )}
              </DialogTitle>
              {previewTemplate.description && (
                <DialogDescription>
                  {previewTemplate.description}
                </DialogDescription>
              )}
            </DialogHeader>

            <div className="space-y-4">
              {previewTemplate.systemPrompt && (
                <div>
                  <h4 className="mb-2 text-sm font-semibold">System Prompt</h4>
                  <div className="rounded-md bg-muted p-3 text-sm">
                    {previewTemplate.systemPrompt}
                  </div>
                </div>
              )}

              <div>
                <h4 className="mb-2 text-sm font-semibold">User Prompt</h4>
                <div className="rounded-md bg-muted p-3 text-sm">
                  {previewTemplate.userPrompt}
                </div>
              </div>

              {previewTemplate.tags && previewTemplate.tags.length > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-semibold">Tags</h4>
                  <div className="flex flex-wrap gap-1">
                    {previewTemplate.tags.map((tag) => (
                      <Badge key={tag} variant="outline" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-4">
              <Button
                onClick={() => {
                  handleTemplateSelect(previewTemplate)
                  setPreviewTemplate(null)
                }}
                className="flex-1">
                Use Template
              </Button>
              <Button
                variant="outline"
                onClick={() => copyToClipboard(previewTemplate.userPrompt)}>
                <Copy className="mr-2 h-4 w-4" />
                Copy
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
