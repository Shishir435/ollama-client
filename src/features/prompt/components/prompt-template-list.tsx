import { useState } from "react"
import { useTranslation } from "react-i18next"
import { ConfirmActionDialog } from "@/components/settings"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "@/components/ui/collapsible"
import { Separator } from "@/components/ui/separator"
import { CopyButton } from "@/features/chat/components"
import { Calendar, ChevronRight, Star, Trash2 } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"
import type { PromptTemplate } from "@/types"
import { PromptTemplateForm } from "./prompt-template-form"

export interface PromptTemplateListProps {
  templates: PromptTemplate[]
  expandedId: string | null
  onToggleExpand: (id: string) => void
  onUpdateTemplate: (id: string, updates: Partial<PromptTemplate>) => void
  onDeleteTemplate: (id: string) => void
}

export const PromptTemplateList = ({
  templates,
  expandedId,
  onToggleExpand,
  onUpdateTemplate,
  onDeleteTemplate
}: PromptTemplateListProps) => {
  const { t } = useTranslation()
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  return (
    <>
      <div className="space-y-3">
        {templates.map((template) => {
          const isExpanded = expandedId === template.id

          return (
            <Collapsible
              key={template.id}
              open={isExpanded}
              onOpenChange={() => onToggleExpand(template.id)}>
              <Card>
                <CollapsibleTrigger
                  render={<div className="group cursor-pointer px-4" />}>
                  <div className="flex items-center gap-2">
                    <ChevronRight
                      className={cn(
                        "icon-md shrink-0 text-muted-foreground transition-transform duration-200",
                        isExpanded && "rotate-90"
                      )}
                    />
                    <h3 className="flex-1 truncate font-medium">
                      {template.title || "Untitled"}
                    </h3>
                    {template.category && (
                      <Badge variant="outline" className="shrink-0">
                        {template.category}
                      </Badge>
                    )}
                    {(template.usageCount || 0) > 0 && (
                      <Badge
                        variant="secondary"
                        className="shrink-0 gap-1 px-1.5 py-0.5 text-xs">
                        {template.usageCount}
                      </Badge>
                    )}
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    <p className="flex-1 truncate text-sm text-muted-foreground">
                      {template.description ||
                        template.userPrompt?.slice(0, 80) ||
                        t("settings.prompts.no_description")}
                    </p>
                    <div className="flex shrink-0 gap-1">
                      <CopyButton text={template.userPrompt} />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation()
                          setDeleteConfirmId(template.id)
                        }}>
                        <Trash2 className="icon-md" />
                      </Button>
                    </div>
                  </div>
                </CollapsibleTrigger>

                <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
                  <Separator />
                  <div className="p-4">
                    <PromptTemplateForm
                      initialValues={template}
                      onSubmit={(updated) =>
                        onUpdateTemplate(template.id, updated)
                      }
                      isEditing
                    />
                  </div>

                  {(template.createdAt || (template.usageCount || 0) > 0) && (
                    <>
                      <Separator />
                      <div className="flex gap-4 px-4 py-3 text-sm text-muted-foreground">
                        {template.createdAt && (
                          <div className="flex items-center gap-1.5">
                            <Calendar className="icon-sm" />
                            {t("settings.prompts.created_at", {
                              date: new Date(
                                template.createdAt
                              ).toLocaleDateString()
                            })}
                          </div>
                        )}
                        {(template.usageCount || 0) > 0 && (
                          <div className="flex items-center gap-1.5">
                            <Star className="icon-sm" />
                            {t("settings.prompts.used_times", {
                              count: template.usageCount
                            })}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </CollapsibleContent>
              </Card>
            </Collapsible>
          )
        })}
      </div>

      <ConfirmActionDialog
        open={deleteConfirmId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirmId(null)
        }}
        title={t("settings.prompts.delete_dialog.title")}
        description={t("settings.prompts.delete_dialog.description", {
          title: templates.find((t) => t.id === deleteConfirmId)?.title ?? ""
        })}
        confirmLabel={t("settings.prompts.delete_dialog.confirm")}
        cancelLabel={t("settings.prompts.delete_dialog.cancel")}
        destructive
        onConfirm={() => {
          if (deleteConfirmId) onDeleteTemplate(deleteConfirmId)
          setDeleteConfirmId(null)
        }}
      />
    </>
  )
}
