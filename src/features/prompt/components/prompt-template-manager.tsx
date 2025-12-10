import { useState } from "react"
import { useTranslation } from "react-i18next"
import { SettingsCard } from "@/components/settings"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { usePromptTemplates } from "@/features/prompt/hooks/use-prompt-templates"
import { FileText, Search } from "@/lib/lucide-icon"
import type { PromptTemplate } from "@/types"
import { PromptTemplateActions } from "./prompt-template-actions"
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

  const [activeTab, setActiveTab] = useState("new")
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
    setActiveTab(template.id)
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
        })}>
        <div className="-mt-2 flex justify-end">
          <PromptTemplateActions
            onExport={handleExport}
            onImport={importTemplates}
            onReset={resetToDefaults}
          />
        </div>
        <div className="mt-4 flex gap-4">
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

        <PromptTemplateList
          templates={filteredTemplates}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onAddTemplate={handleAddTemplate}
          onUpdateTemplate={updateTemplate}
          onDeleteTemplate={deleteTemplate}
        />
      </SettingsCard>
    </div>
  )
}
