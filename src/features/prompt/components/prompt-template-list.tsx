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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "@/components/ui/collapsible"
import { Separator } from "@/components/ui/separator"
import {
  Calendar,
  ChevronRight,
  Copy,
  CopyCheck,
  Star,
  Trash2
} from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"
import type { PromptTemplate } from "@/types"
import { PromptTemplateForm } from "./prompt-template-form"

interface PromptTemplateListProps {
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
    <div className="space-y-3">
      {templates.map((template) => {
        const isExpanded = expandedId === template.id

        return (
          <Collapsible
            key={template.id}
            open={isExpanded}
            onOpenChange={() => onToggleExpand(template.id)}>
            <div
              className={cn(
                "rounded-lg border transition-all duration-200",
                isExpanded
                  ? "border-primary/30 bg-accent/5"
                  : "border-border hover:border-muted-foreground/30"
              )}>
              {/* Card Header - Always Visible */}
              <CollapsibleTrigger asChild>
                <div className="group cursor-pointer p-4 transition-colors hover:bg-accent/30">
                  {/* Row 1: Chevron + Title + Category Badge */}
                  <div className="flex items-center gap-2">
                    <ChevronRight
                      className={cn(
                        "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
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

                  {/* Row 2: Description + Action Buttons */}
                  <div className="mt-2 flex items-center gap-2">
                    <p className="flex-1 truncate text-sm text-muted-foreground">
                      {template.description ||
                        template.userPrompt?.slice(0, 80) ||
                        t("settings.prompts.no_description")}
                    </p>

                    {/* Action Buttons - Stop propagation to prevent expand toggle */}
                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => {
                          e.stopPropagation()
                          copyToClipboard(template.userPrompt, template.id)
                        }}>
                        {copiedId === template.id ? (
                          <CopyCheck className="h-4 w-4 text-green-500" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>

                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={(e) => e.stopPropagation()}>
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
                </div>
              </CollapsibleTrigger>

              {/* Expanded Content */}
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

                {/* Metadata Footer */}
                {(template.createdAt || (template.usageCount || 0) > 0) && (
                  <>
                    <Separator />
                    <div className="flex gap-4 px-4 py-3 text-sm text-muted-foreground">
                      {template.createdAt && (
                        <div className="flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5" />
                          {t("settings.prompts.created_at", {
                            date: new Date(
                              template.createdAt
                            ).toLocaleDateString()
                          })}
                        </div>
                      )}
                      {(template.usageCount || 0) > 0 && (
                        <div className="flex items-center gap-1.5">
                          <Star className="h-3.5 w-3.5" />
                          {t("settings.prompts.used_times", {
                            count: template.usageCount
                          })}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </CollapsibleContent>
            </div>
          </Collapsible>
        )
      })}
    </div>
  )
}
