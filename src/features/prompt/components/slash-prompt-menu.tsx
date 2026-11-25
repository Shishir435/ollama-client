import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/class-names"
import type { PromptTemplate } from "@/types"

export const SLASH_MENU_ID = "slash-prompt-menu"

/** The id the textarea points `aria-activedescendant` at for one option. */
export const slashOptionId = (templateId: string): string =>
  `${SLASH_MENU_ID}-${templateId}`

interface SlashPromptMenuProps {
  templates: readonly PromptTemplate[]
  activeIndex: number
  onSelect: (template: PromptTemplate) => void
  onActiveChange: (index: number) => void
}

/**
 * The templates a `/` in the composer offers. Focus never leaves the textarea:
 * the list is driven by its keys and announced through `aria-activedescendant`,
 * and a mouse press is swallowed so choosing an item does not blur the field.
 */
export function SlashPromptMenu({
  templates,
  activeIndex,
  onSelect,
  onActiveChange
}: SlashPromptMenuProps) {
  const { t } = useTranslation()
  const activeRef = useRef<HTMLLIElement>(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: "nearest" })
  }, [activeIndex])

  return (
    <div className="absolute inset-x-0 bottom-full z-20 mb-2 overflow-hidden rounded-panel border border-border bg-popover shadow-lg">
      <ul
        id={SLASH_MENU_ID}
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role, jsx-a11y/prefer-tag-over-role -- a combobox popup the textarea drives with aria-activedescendant; a native select would take focus from the field
        role="listbox"
        aria-label={t("prompts.slash.title")}
        className="max-h-60 overflow-y-auto p-1">
        {templates.map((template, index) => (
          // oxlint-disable-next-line jsx-a11y/click-events-have-key-events -- the textarea that owns focus handles the keys
          <li
            key={template.id}
            id={slashOptionId(template.id)}
            ref={index === activeIndex ? activeRef : undefined}
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role, jsx-a11y/prefer-tag-over-role -- options are not focusable; the textarea that owns focus handles the keys
            role="option"
            aria-selected={index === activeIndex}
            className={cn(
              "grid cursor-pointer gap-0.5 rounded-control px-2 py-1.5",
              index === activeIndex && "bg-state-hover"
            )}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => onActiveChange(index)}
            onClick={() => onSelect(template)}>
            <span className="truncate text-sm font-medium">
              {template.title}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {template.description || template.userPrompt}
            </span>
          </li>
        ))}
      </ul>
      <p className="border-t border-border px-2 py-1 text-2xs text-foreground-tertiary">
        {t("prompts.slash.hint")}
      </p>
    </div>
  )
}
