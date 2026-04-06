import { useStorage } from "@plasmohq/storage/hook"
import { AppWindow, BrainCircuit } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
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

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 rounded-lg"
              aria-label={t("tabs.context")}>
              <Layers className="size-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("tabs.context")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-max">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs items-center gap-1.5 flex uppercase tracking-wide text-muted-foreground px-2 py-1.5 font-bold">
            <Layers className="size-3" />
            {t("tabs.context")}
          </DropdownMenuLabel>
          <DropdownMenuCheckboxItem
            checked={tabAccess}
            onCheckedChange={(value) => setTabAccess(Boolean(value))}
            className="gap-2 text-xs py-2">
            <AppWindow className="h-3.5 w-3.5" />
            {tabAccess ? t("tabs.toggle.label_on") : t("tabs.toggle.label_off")}
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={useRAG}
            onCheckedChange={(value) => setUseRAG(Boolean(value))}
            className="gap-2 text-xs py-2">
            <BrainCircuit className="h-3.5 w-3.5" />
            {useRAG
              ? t("chat.input.rag_toggle_on")
              : t("chat.input.rag_toggle_off")}
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
