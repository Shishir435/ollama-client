import { Globe, Library, PanelsTopLeft } from "lucide-react"
import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import { cn } from "@/lib/utils"

interface ComposerContextChipsProps {
  useRAG: boolean
  tabAccess: boolean
  webSearchEnabled?: boolean
  onToggleRAG: () => void
  onToggleTabs: () => void
}

export const ComposerContextChips = ({
  useRAG,
  tabAccess,
  webSearchEnabled = false,
  onToggleRAG,
  onToggleTabs
}: ComposerContextChipsProps) => {
  const { t } = useTranslation()

  const chips = [
    {
      key: "rag",
      label: t("chat.composer.rag", "Files"),
      active: useRAG,
      disabled: false,
      onClick: onToggleRAG,
      icon: Library
    },
    {
      key: "tabs",
      label: t("chat.composer.tabs", "Page"),
      active: tabAccess,
      disabled: false,
      onClick: onToggleTabs,
      icon: PanelsTopLeft
    },
    {
      key: "web",
      label: t("chat.composer.web", "Web"),
      active: webSearchEnabled,
      disabled: true,
      hidden: !webSearchEnabled,
      onClick: () => {},
      icon: Globe
    }
  ]

  return (
    <div className="flex flex-wrap gap-1.5 px-2.5 pt-2.5">
      {chips.map((chip) => {
        if (chip.hidden) return null
        const Icon = chip.icon
        return (
          <TooltipActionButton
            key={chip.key}
            type="button"
            variant="ghost"
            size="icon"
            label={chip.label}
            aria-pressed={chip.active}
            disabled={chip.disabled}
            onClick={chip.onClick}
            className={cn(
              "size-7 rounded-control",
              chip.active
                ? "bg-app-primary-soft text-app-agent"
                : "bg-background/60 text-muted-foreground hover:bg-muted/70",
              chip.disabled && "opacity-45"
            )}
            icon={<Icon className="size-3.5" />}
          />
        )
      })}
    </div>
  )
}
