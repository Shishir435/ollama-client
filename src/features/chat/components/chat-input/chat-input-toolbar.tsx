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
    <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between rounded-b-xl border-t border-border/30 bg-muted/30 p-2">
      <div className="flex items-center gap-2">
        <ModelMenu
          showStatusPopup={false}
          tooltipTextContent={t("chat.input.switch_model")}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary"
              size="sm"
              className="h-8 gap-1.5 rounded-full px-3 text-xs"
              aria-label={t("tabs.context")}>
              <Layers className="h-3.5 w-3.5" />
              {t("tabs.context")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground px-2">
                {t("tabs.context")}
              </DropdownMenuLabel>
              <DropdownMenuCheckboxItem
                checked={tabAccess}
                onCheckedChange={(value) => setTabAccess(Boolean(value))}
                className="gap-2">
                <AppWindow className="h-3.5 w-3.5" />
                {tabAccess
                  ? t("tabs.toggle.label_on")
                  : t("tabs.toggle.label_off")}
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={useRAG}
                onCheckedChange={(value) => setUseRAG(Boolean(value))}
                className="gap-2">
                <BrainCircuit className="h-3.5 w-3.5" />
                {useRAG
                  ? t("chat.input.rag_toggle_on")
                  : t("chat.input.rag_toggle_off")}
              </DropdownMenuCheckboxItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2"
              onClick={() => {
                void openOptionsInTab()
              }}>
              <Settings className="h-3.5 w-3.5" />
              {t("common.settings.label")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
