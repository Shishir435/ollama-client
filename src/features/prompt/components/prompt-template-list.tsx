import { useState } from "react"
import { useTranslation } from "react-i18next"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  BarChart3,
  Calendar,
  Copy,
  CopyCheck,
  Plus,
  Star,
  Trash2
} from "@/lib/lucide-icon"
import type { PromptTemplate } from "@/types"
import { PromptTemplateForm } from "./prompt-template-form"

interface PromptTemplateListProps {
  templates: PromptTemplate[]
  activeTab: string
  onTabChange: (value: string) => void
  onAddTemplate: (
    template: Omit<PromptTemplate, "createdAt" | "usageCount">
  ) => void
  onUpdateTemplate: (id: string, updates: Partial<PromptTemplate>) => void
  onDeleteTemplate: (id: string) => void
}

export const PromptTemplateList = ({
  templates,
  activeTab,
  onTabChange,
  onAddTemplate,
  onUpdateTemplate,
  onDeleteTemplate
}: PromptTemplateListProps) => {
  const { t } = useTranslation()
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch (err) {
      console.error("Failed to copy: ", err)
    }
  }

  return (
    <Tabs value={activeTab} onValueChange={onTabChange} className="w-full">
      <ScrollArea className="w-full">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-2 p-1">
          <TabsTrigger
            value="new"
            className="flex items-center gap-2 text-xs sm:text-sm">
            <Plus className="h-4 w-4" />
            {t("settings.prompts.new_template")}
          </TabsTrigger>
          {templates.map((template) => (
            <TabsTrigger
              key={template.id}
              value={template.id}
              className="flex max-w-[200px] items-center gap-2 text-xs sm:text-sm">
              <span className="truncate">{template.title || "Untitled"}</span>
              {(template.usageCount || 0) > 0 && (
                <Badge variant="secondary" className="px-1 py-0 text-xs">
                  {template.usageCount}
                </Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </ScrollArea>

      <TabsContent value="new" className="space-y-4">
        <PromptTemplateForm onSubmit={onAddTemplate} />
      </TabsContent>

      {templates.map((template) => (
        <TabsContent
          key={template.id}
          value={template.id}
          className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">{template.title}</h3>
              {template.category && (
                <Badge variant="outline">{template.category}</Badge>
              )}
              {(template.usageCount || 0) > 0 && (
                <Badge variant="secondary" className="gap-1">
                  <BarChart3 className="h-3 w-3" />
                  {template.usageCount}
                </Badge>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  copyToClipboard(template.userPrompt, template.id)
                }>
                {copiedId === template.id ? (
                  <CopyCheck className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t("settings.prompts.delete_dialog.title")}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("settings.prompts.delete_dialog.description", {
                        title: template.title
                      })}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>
                      {t("settings.prompts.delete_dialog.cancel")}
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => onDeleteTemplate(template.id)}>
                      {t("settings.prompts.delete_dialog.confirm")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>

          <PromptTemplateForm
            initialValues={template}
            onSubmit={(updated) => onUpdateTemplate(template.id, updated)}
            isEditing
          />

          {(template.createdAt || template.usageCount) && (
            <div className="flex gap-4 border-t pt-2 text-sm text-muted-foreground">
              {template.createdAt && (
                <div className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {t("settings.prompts.created_at", {
                    date: new Date(template.createdAt).toLocaleDateString()
                  })}
                </div>
              )}
              {(template.usageCount || 0) > 0 && (
                <div className="flex items-center gap-1">
                  <Star className="h-3 w-3" />
                  {t("settings.prompts.used_times", {
                    count: template.usageCount
                  })}
                </div>
              )}
            </div>
          )}
        </TabsContent>
      ))}
    </Tabs>
  )
}
