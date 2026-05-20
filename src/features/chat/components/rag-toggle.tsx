import { useStorage } from "@plasmohq/storage/hook"
import { BrainCircuit } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Toggle } from "@/components/ui/toggle"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { cn } from "@/lib/utils"
export const RAGToggle = () => {
  const { t } = useTranslation()
  const [useRAG, setUseRAG] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.EMBEDDINGS.USE_RAG,
      instance: plasmoGlobalStorage
    },
    true
  )

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            pressed={useRAG}
            onPressedChange={setUseRAG}
            aria-label={t("chat.input.rag_toggle_tooltip")}
            className={cn(
              "size-8 p-0",
              useRAG
                ? "text-status-success hover:text-status-success/80 hover:bg-muted"
                : "text-muted-foreground hover:text-muted-foreground hover:bg-muted"
            )}
          />
        }>
        <BrainCircuit className="size-4" />
      </TooltipTrigger>
      <TooltipContent side="top">
        <p>{t("chat.input.rag_toggle_tooltip")}</p>
      </TooltipContent>
    </Tooltip>
  )
}
