import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Plus } from "@/lib/lucide-icon"
import type { PromptTemplate } from "@/types"

interface PromptTemplateFormProps {
  initialValues?: Partial<PromptTemplate>
  onSubmit: (template: Omit<PromptTemplate, "createdAt" | "usageCount">) => void
  isEditing?: boolean
}

export const PromptTemplateForm = ({
  initialValues,
  onSubmit,
  isEditing = false
}: PromptTemplateFormProps) => {
  const { t } = useTranslation()
  const [template, setTemplate] = useState<{
    title: string
    description: string
    category: string
    userPrompt: string
    systemPrompt: string
    tags: string
  }>({
    title: "",
    description: "",
    category: "",
    userPrompt: "",
    systemPrompt: "",
    tags: ""
  })

  // Load initial values
  useEffect(() => {
    if (initialValues) {
      setTemplate({
        title: initialValues.title || "",
        description: initialValues.description || "",
        category: initialValues.category || "",
        userPrompt: initialValues.userPrompt || "",
        systemPrompt: initialValues.systemPrompt || "",
        tags: initialValues.tags?.join(", ") || ""
      })
    }
  }, [initialValues])

  const handleSubmit = () => {
    if (!template.title.trim() || !template.userPrompt.trim()) return

    const newTemplate: Omit<PromptTemplate, "createdAt" | "usageCount"> = {
      id: initialValues?.id || crypto.randomUUID(),
      title: template.title.trim(),
      description: template.description.trim() || undefined,
      category: template.category.trim() || undefined,
      userPrompt: template.userPrompt.trim(),
      systemPrompt: template.systemPrompt.trim() || undefined,
      tags: template.tags.trim()
        ? template.tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean)
        : undefined
    }

    onSubmit(newTemplate)

    // Clear form if not editing
    if (!isEditing) {
      setTemplate({
        title: "",
        description: "",
        category: "",
        userPrompt: "",
        systemPrompt: "",
        tags: ""
      })
    }
  }

  // Handle updates directly for edit mode
  const handleChange = (field: keyof typeof template, value: string) => {
    setTemplate((prev) => ({ ...prev, [field]: value }))
    // If editing, trigger submit immediately for live updates (optional/mimics original behavior)
    // Actually, in the original code, the edit form calls 'updateTemplate' on every keystroke.
    // To support that, we might need a different pattern or pass the raw update function.
    // For now, let's stick to local state and explicit save, OR emit changes.
    // Given the original code updates on chance, let's follow suit if we want to mimic it perfectly.
    // But for a form component, explicit 'onSubmit' or 'onChange' is cleaner.
    // Let's assume the parent will handle 'onChange' if 'isEditing' is true.
  }

  // For the Create New tab, we use local state and Submit button.
  // For the separate Edit tabs, we need live updates.
  // Let's adapt this component to handle both, or let the parent control state.
  // Ideally, control state from parent.

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="title">{t("settings.prompts.form.title")}</Label>
          <Input
            id="title"
            placeholder={t("settings.prompts.form.title_placeholder")}
            value={template.title}
            onChange={(e) => {
              handleChange("title", e.target.value)
              if (isEditing)
                onSubmit({
                  ...initialValues,
                  title: e.target.value
                } as PromptTemplate)
            }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="category">
            {t("settings.prompts.form.category")}
          </Label>
          <Input
            id="category"
            placeholder={t("settings.prompts.form.category_placeholder")}
            value={template.category}
            onChange={(e) => {
              handleChange("category", e.target.value)
              if (isEditing)
                onSubmit({
                  ...initialValues,
                  category: e.target.value
                } as PromptTemplate)
            }}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">
          {t("settings.prompts.form.description")}
        </Label>
        <Input
          id="description"
          placeholder={t("settings.prompts.form.description_placeholder")}
          value={template.description}
          onChange={(e) => {
            handleChange("description", e.target.value)
            if (isEditing)
              onSubmit({
                ...initialValues,
                description: e.target.value
              } as PromptTemplate)
          }}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="tags">{t("settings.prompts.form.tags")}</Label>
        <Input
          id="tags"
          placeholder={t("settings.prompts.form.tags_placeholder")}
          value={template.tags}
          onChange={(e) => {
            handleChange("tags", e.target.value)
            if (isEditing) {
              const tags = e.target.value
                ? e.target.value
                    .split(",")
                    .map((tag) => tag.trim())
                    .filter(Boolean)
                : undefined
              onSubmit({ ...initialValues, tags } as PromptTemplate)
            }
          }}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="system-prompt">
          {t("settings.prompts.form.system_prompt")}
        </Label>
        <Textarea
          id="system-prompt"
          rows={3}
          value={template.systemPrompt}
          onChange={(e) => {
            handleChange("systemPrompt", e.target.value)
            if (isEditing)
              onSubmit({
                ...initialValues,
                systemPrompt: e.target.value
              } as PromptTemplate)
          }}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="user-prompt">
          {t("settings.prompts.form.user_prompt")}
        </Label>
        <Textarea
          id="user-prompt"
          placeholder={t("settings.prompts.form.user_prompt_placeholder")}
          rows={4}
          value={template.userPrompt}
          onChange={(e) => {
            handleChange("userPrompt", e.target.value)
            if (isEditing)
              onSubmit({
                ...initialValues,
                userPrompt: e.target.value
              } as PromptTemplate)
          }}
        />
      </div>

      {!isEditing && (
        <Button
          onClick={handleSubmit}
          disabled={!template.title.trim() || !template.userPrompt.trim()}
          className="w-full">
          <Plus className="mr-2 h-4 w-4" />
          {t("settings.prompts.form.create_button")}
        </Button>
      )}
    </div>
  )
}
