import { useStorage } from "@plasmohq/storage/hook"
import { AppWindow, Database, ShieldCheck } from "lucide-react"
import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { STORAGE_KEYS } from "@/lib/constants"
import { Layers } from "@/lib/lucide-icon"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

export const ContextSettingsMenu = () => {
  const { t } = useTranslation()
  const [useRAG, setUseRAG] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.EMBEDDINGS.USE_RAG,
      instance: plasmoGlobalStorage
    },
    true
  )
  const [tabAccess, setTabAccess] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.BROWSER.TABS_ACCESS,
      instance: plasmoGlobalStorage
    },
    false
  )
  const [groundedOnlyMode, setGroundedOnlyMode] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.CHAT.GROUNDED_ONLY_MODE,
      instance: plasmoGlobalStorage
    },
    false
  )
  const contextActions = [
    {
      key: "page",
      checked: tabAccess,
      onCheckedChange: (value: boolean) => setTabAccess(value),
      icon: AppWindow,
      label: tabAccess ? t("tabs.toggle.label_on") : t("tabs.toggle.label_off")
    },
    {
      key: "files",
      checked: useRAG,
      onCheckedChange: (value: boolean) => setUseRAG(value),
      icon: Database,
      label: useRAG
        ? t("chat.input.rag_toggle_on")
        : t("chat.input.rag_toggle_off")
    },
    {
      key: "grounded",
      checked: groundedOnlyMode,
      onCheckedChange: (value: boolean) => setGroundedOnlyMode(value),
      icon: ShieldCheck,
      label: t("settings.grounding_mode.label")
    }
  ]

  return (
    <DropdownMenu>
      <TooltipActionButton
        trigger={
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="size-8 rounded-control text-muted-foreground hover:bg-muted/55 hover:text-foreground"
                aria-label={t("tabs.context")}
              />
            }
          />
        }
        label={t("tabs.context")}
        icon={<Layers className="size-4" />}
      />
      <DropdownMenuContent align="start" className="w-max">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs items-center gap-1.5 flex uppercase tracking-wide text-muted-foreground px-2 py-1.5 font-bold">
            <Layers className="size-3" />
            {t("tabs.context")}
          </DropdownMenuLabel>
          {contextActions.map((action) => {
            const Icon = action.icon
            return (
              <DropdownMenuCheckboxItem
                key={action.key}
                checked={action.checked}
                onCheckedChange={(value) =>
                  action.onCheckedChange(Boolean(value))
                }
                className="gap-2 text-xs py-2">
                <Icon className="size-3.5" />
                {action.label}
              </DropdownMenuCheckboxItem>
            )
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
