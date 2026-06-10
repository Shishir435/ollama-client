import type { ReactElement } from "react"
import type { ActionConfig } from "@/components/actions/action-group"
import type { LucideIcon } from "@/lib/lucide-icon"

export interface CommandDefinition<TId extends string = string> {
  id: TId
  icon?: LucideIcon | ReactElement
  labelKey: string
  tooltipKey?: string
  ariaLabelKey?: string
  shortcut?: string
  disabled?: boolean | (() => boolean)
  run?: () => void
}

export type CommandRegistry<TId extends string> = Record<
  TId,
  CommandDefinition<TId>
>

export function defineCommandRegistry<const T extends CommandRegistry<string>>(
  registry: T
) {
  return registry
}

interface CommandActionOptions<TId extends string>
  extends Omit<
    ActionConfig,
    "key" | "icon" | "label" | "labelKey" | "tooltip" | "tooltipKey"
  > {
  command: CommandDefinition<TId>
  t: (key: string) => string
  tooltipKey?: string
  labelKey?: string
}

export function commandToActionConfig<TId extends string>({
  command,
  t,
  labelKey,
  tooltipKey,
  ...action
}: CommandActionOptions<TId>): ActionConfig {
  const resolvedLabelKey = labelKey ?? command.labelKey
  const resolvedTooltipKey =
    tooltipKey ?? command.tooltipKey ?? resolvedLabelKey

  return {
    key: command.id,
    label: t(resolvedLabelKey),
    tooltip: t(resolvedTooltipKey),
    ariaLabel: t(command.ariaLabelKey ?? resolvedLabelKey),
    icon: command.icon,
    disabled:
      typeof command.disabled === "function"
        ? command.disabled()
        : command.disabled,
    onClick: command.run,
    ...action
  }
}
