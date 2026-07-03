import { useState } from "react"

import { TooltipActionButton } from "@/components/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Plus, Trash2 } from "@/lib/lucide-icon"

interface ModelIdListEditorProps {
  models: string[]
  onChange: (models: string[]) => void
  addLabel: string
  removeLabel: string
  placeholder: string
}

/**
 * Controlled manual-model editor shared by provider creation and settings.
 * Discovery remains provider-owned; these ids only supplement missing models.
 */
export const ModelIdListEditor = ({
  models,
  onChange,
  addLabel,
  removeLabel,
  placeholder
}: ModelIdListEditorProps) => {
  const [draft, setDraft] = useState("")

  const add = () => {
    const value = draft.trim()
    if (!value || models.includes(value)) return
    onChange([...models, value])
    setDraft("")
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              add()
            }
          }}
          placeholder={placeholder}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={add}
          disabled={!draft.trim() || models.includes(draft.trim())}>
          <Plus className="icon-sm" />
          {addLabel}
        </Button>
      </div>

      {models.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {models.map((model) => (
            <span
              key={model}
              className="flex items-center gap-1 rounded-control bg-secondary px-2 py-1 text-xs text-secondary-foreground">
              <span className="max-w-64 truncate">{model}</span>
              <TooltipActionButton
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-5 hover:text-destructive"
                onClick={() =>
                  onChange(models.filter((candidate) => candidate !== model))
                }
                icon={Trash2}
                iconClassName="icon-xs"
                label={`${removeLabel} ${model}`}
              />
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
