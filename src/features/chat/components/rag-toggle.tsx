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
      <TooltipTrigger asChild>
        <Toggle
          pressed={useRAG}
          onPressedChange={setUseRAG}
          aria-label={t("chat.input.rag_toggle_tooltip")}
          className={cn(
            "size-8 p-0",
            useRAG
              ? "text-green-500 hover:text-green-600 hover:bg-muted"
              : "text-muted-foreground hover:text-muted-foreground hover:bg-muted"
          )}>
          <BrainCircuit className="size-4" />
        </Toggle>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p>{t("chat.input.rag_toggle_tooltip")}</p>
      </TooltipContent>
    </Tooltip>
  )
}
