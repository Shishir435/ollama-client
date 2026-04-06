import { useState } from "react"
import { useTranslation } from "react-i18next"
import { SettingsCard } from "@/components/settings"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { usePromptTemplates } from "@/features/prompt/hooks/use-prompt-templates"
import { ChevronDown, FileText, Plus, Search } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"
import type { PromptTemplate } from "@/types"
import { PromptTemplateActions } from "./prompt-template-actions"
import { PromptTemplateForm } from "./prompt-template-form"
import { PromptTemplateList } from "./prompt-template-list"

export const PromptTemplateManager = () => {
  const { t } = useTranslation()
  const {
    templates,
    addTemplate,
    updateTemplate,
    deleteTemplate,
    importTemplates,
    exportTemplates,
    resetToDefaults,
    getCategories
  } = usePromptTemplates()

  const [showCreateForm, setShowCreateForm] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedCategory, setSelectedCategory] = useState<string>("all")
  const [sortBy, setSortBy] = useState<"recent" | "popular" | "alphabetical">(
    "recent"
  )

  const categories = getCategories()

  const filteredTemplates =
    templates
      ?.filter((template) => {
        const matchesSearch =
          !searchQuery ||
          template.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          template.description
            ?.toLowerCase()
            .includes(searchQuery.toLowerCase()) ||
          template.userPrompt.toLowerCase().includes(searchQuery.toLowerCase())

        const matchesCategory =
          selectedCategory === "all" || template.category === selectedCategory

        return matchesSearch && matchesCategory
      })
      .sort((a, b) => {
        switch (sortBy) {
          case "popular":
            return (b.usageCount || 0) - (a.usageCount || 0)
          case "alphabetical":
            return a.title.localeCompare(b.title)
          default:
            return (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0)
        }
      }) || []

  const handleAddTemplate = (
    template: Omit<PromptTemplate, "createdAt" | "usageCount">
  ) => {
    addTemplate(template)
    setShowCreateForm(false)
    setExpandedId(template.id)
  }

  const handleToggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id))
    if (showCreateForm) {
      setShowCreateForm(false)
    }
  }

  const handleToggleCreateForm = () => {
    setShowCreateForm((prev) => !prev)
    if (expandedId) {
      setExpandedId(null)
    }
  }

  const handleExport = () => {
    const dataStr = JSON.stringify(exportTemplates(), null, 2)
    const dataUri = `data:application/json;charset=utf-8,${encodeURIComponent(dataStr)}`

    const exportFileDefaultName = `prompt-templates-${new Date().toISOString().split("T")[0]}.json`

    const linkElement = document.createElement("a")
    linkElement.setAttribute("href", dataUri)
    linkElement.setAttribute("download", exportFileDefaultName)
    linkElement.click()
  }

  return (
    <div className="mx-auto space-y-4">
      <SettingsCard
        icon={FileText}
        title={t("settings.prompts.title")}
        description={t("settings.prompts.description", {
          count: templates?.length || 0
        })}
        headerActions={
          <div className="flex items-center gap-2">
            <Button
              variant={showCreateForm ? "secondary" : "default"}
              size="sm"
              onClick={handleToggleCreateForm}
              className="gap-1.5">
              <Plus className="h-4 w-4" />
              {t("settings.prompts.new_template")}
            </Button>
            <PromptTemplateActions
              onExport={handleExport}
              onImport={importTemplates}
              onReset={resetToDefaults}
            />
          </div>
        }>
        {/* Create Form Collapsible */}
        <Collapsible open={showCreateForm} onOpenChange={setShowCreateForm}>
          <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
            <div className="rounded-lg border border-primary/20 bg-accent/5 p-4">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="mb-4 flex w-full items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground">
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 transition-transform",
                      showCreateForm && "rotate-180"
                    )}
                  />
                  {t("settings.prompts.new_template")}
                </button>
              </CollapsibleTrigger>
              <PromptTemplateForm onSubmit={handleAddTemplate} />
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Toolbar */}
        <div className="flex gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-muted-foreground" />
            <Input
              placeholder={t("settings.prompts.search_placeholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
            <SelectTrigger className="w-40">
              <SelectValue
                placeholder={t("settings.prompts.category_placeholder")}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {t("settings.prompts.all_categories")}
              </SelectItem>
              {categories.map((category) => (
                <SelectItem key={category} value={category}>
                  {category}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={sortBy}
            onValueChange={(value: "recent" | "popular" | "alphabetical") =>
              setSortBy(value)
            }>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">
                {t("settings.prompts.sort.recent")}
              </SelectItem>
              <SelectItem value="popular">
                {t("settings.prompts.sort.popular")}
              </SelectItem>
              <SelectItem value="alphabetical">
                {t("settings.prompts.sort.alphabetical")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Separator />

        {/* Template List or Empty State */}
        {filteredTemplates.length > 0 ? (
          <PromptTemplateList
            templates={filteredTemplates}
            expandedId={expandedId}
            onToggleExpand={handleToggleExpand}
            onUpdateTemplate={updateTemplate}
            onDeleteTemplate={deleteTemplate}
          />
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              {t("settings.prompts.empty_state.title")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground/60">
              {t("settings.prompts.empty_state.description")}
            </p>
          </div>
        )}
      </SettingsCard>
    </div>
  )
}
