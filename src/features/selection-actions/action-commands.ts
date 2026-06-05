import { defineCommandRegistry } from "@/components/actions"
import {
  HelpCircle,
  Languages,
  ListChecks,
  type LucideIcon,
  Scissors,
  Sparkles,
  SquarePen
} from "@/lib/lucide-icon"
import type { SelectionActionId } from "./types"

export const SELECTION_ACTION_COMMANDS = defineCommandRegistry<
  Record<
    SelectionActionId,
    {
      id: SelectionActionId
      icon: LucideIcon
      labelKey: string
      tooltipKey: string
      shortLabelKey: string
      placement: "quick" | "more"
    }
  >
>({
  summarize: {
    id: "summarize",
    icon: Sparkles,
    labelKey: "selection_button.actions.summarize.label",
    tooltipKey: "selection_button.actions.summarize.label",
    shortLabelKey: "selection_button.actions.summarize.short",
    placement: "quick"
  },
  rewrite: {
    id: "rewrite",
    icon: SquarePen,
    labelKey: "selection_button.actions.rewrite.label",
    tooltipKey: "selection_button.actions.rewrite.label",
    shortLabelKey: "selection_button.actions.rewrite.short",
    placement: "quick"
  },
  shorten: {
    id: "shorten",
    icon: Scissors,
    labelKey: "selection_button.actions.shorten.label",
    tooltipKey: "selection_button.actions.shorten.label",
    shortLabelKey: "selection_button.actions.shorten.short",
    placement: "more"
  },
  "fix-grammar": {
    id: "fix-grammar",
    icon: SquarePen,
    labelKey: "selection_button.actions.fix-grammar.label",
    tooltipKey: "selection_button.actions.fix-grammar.label",
    shortLabelKey: "selection_button.actions.fix-grammar.short",
    placement: "more"
  },
  explain: {
    id: "explain",
    icon: HelpCircle,
    labelKey: "selection_button.actions.explain.label",
    tooltipKey: "selection_button.actions.explain.label",
    shortLabelKey: "selection_button.actions.explain.short",
    placement: "quick"
  },
  "action-items": {
    id: "action-items",
    icon: ListChecks,
    labelKey: "selection_button.actions.action-items.label",
    tooltipKey: "selection_button.actions.action-items.label",
    shortLabelKey: "selection_button.actions.action-items.short",
    placement: "more"
  },
  "translate-english": {
    id: "translate-english",
    icon: Languages,
    labelKey: "selection_button.actions.translate-english.label",
    tooltipKey: "selection_button.actions.translate-english.label",
    shortLabelKey: "selection_button.actions.translate-english.short",
    placement: "more"
  },
  custom: {
    id: "custom",
    icon: Sparkles,
    labelKey: "selection_button.actions.custom.label",
    tooltipKey: "selection_button.actions.custom.label",
    shortLabelKey: "selection_button.actions.custom.short",
    placement: "more"
  }
})

export const selectionActionCommand = (id: SelectionActionId) =>
  SELECTION_ACTION_COMMANDS[id]
