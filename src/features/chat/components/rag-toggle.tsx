import { useStorage } from "@plasmohq/storage/hook"
import { useTranslation } from "react-i18next"

import { Switch } from "@/components/ui/switch"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

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
        <div className="flex cursor-pointer items-center space-x-2">
          <Switch
            id="rag-switch"
            checked={useRAG}
            onCheckedChange={setUseRAG}
          />
          {useRAG ? (
            <span className="text-sm">{t("chat.input.rag_toggle_on")}</span>
          ) : (
            <label htmlFor="rag-switch" className="text-sm">
              {t("chat.input.rag_toggle_off")}
            </label>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p>{t("chat.input.rag_toggle_tooltip")}</p>
      </TooltipContent>
    </Tooltip>
  )
}
