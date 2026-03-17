import { useStorage } from "@plasmohq/storage/hook"
import { AppWindow, BrainCircuit } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { CharCount } from "@/features/chat/components/char-count"
import { FileUploadButton } from "@/features/file-upload/components/file-upload-button"
import { ModelMenu } from "@/features/model/components/model-menu"
import { openOptionsInTab } from "@/lib/browser-api"
import { STORAGE_KEYS } from "@/lib/constants"
import { Layers, Settings } from "@/lib/lucide-icon"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

interface ChatInputToolbarProps {
  inputLength: number
  isLoading: boolean
  onFilesSelected: (files: FileList) => void
}

export const ChatInputToolbar = ({
  inputLength,
  isLoading,
  onFilesSelected
}: ChatInputToolbarProps) => {
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
    <div className="absolute bottom-1 left-1 right-1 flex items-center justify-between rounded-xl bg-muted/20 px-2 py-1.5 backdrop-blur-md transition-colors hover:bg-muted/30">
      <div className="flex items-center gap-1.5">
        <ModelMenu
          showStatusPopup={false}
          tooltipTextContent={t("chat.input.switch_model")}
        />
        <div className="h-4 w-px bg-border/40 mx-0.5" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 rounded-lg text-muted-foreground/80 hover:bg-background/80 hover:text-foreground"
              aria-label={t("tabs.context")}>
              <Layers className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-40">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-[10px] items-center gap-1.5 flex uppercase tracking-wide text-muted-foreground px-2 py-1.5 font-bold">
                <Layers className="size-3" />
                {t("tabs.context")}
              </DropdownMenuLabel>
              <DropdownMenuCheckboxItem
                checked={tabAccess}
                onCheckedChange={(value) => setTabAccess(Boolean(value))}
                className="gap-2 text-xs py-2">
                <AppWindow className="h-3.5 w-3.5" />
                {tabAccess
                  ? t("tabs.toggle.label_on")
                  : t("tabs.toggle.label_off")}
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

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 rounded-lg text-muted-foreground/50 hover:bg-background/80 hover:text-foreground/80"
              onClick={() => {
                void openOptionsInTab()
              }}
              aria-label={t("common.settings.label")}>
              <Settings className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("common.settings.label")}</TooltipContent>
        </Tooltip>
        <div className="flex items-center gap-2">
          <FileUploadButton
            onFilesSelected={onFilesSelected}
            disabled={isLoading}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <CharCount count={inputLength} />
        <div className="hidden text-xs text-muted-foreground sm:block">
          <kbd className="rounded bg-muted px-1.5 py-0.5 text-xs">
            {t("chat.input.enter_key")}
          </kbd>{" "}
          {t("chat.input.enter_to_send")}
        </div>
      </div>
    </div>
  )
}
