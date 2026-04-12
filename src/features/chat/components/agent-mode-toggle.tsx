import { useStorage } from "@plasmohq/storage/hook"
import { Bot, BotOff } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { cn } from "@/lib/utils"

export const AgentModeToggle = () => {
  const [agentModeEnabled, setAgentModeEnabled] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.AGENT.MODE_ENABLED,
      instance: plasmoGlobalStorage
    },
    false
  )

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            id="agent-mode-toggle"
            variant="ghost"
            size="icon"
            onClick={() => setAgentModeEnabled(!agentModeEnabled)}
            className={cn(
              "h-7 w-7 rounded-lg transition-all duration-200",
              agentModeEnabled
                ? "bg-violet-500/15 text-violet-500 hover:bg-violet-500/25"
                : "text-muted-foreground hover:text-foreground"
            )}
            aria-label={
              agentModeEnabled ? "Disable agent mode" : "Enable agent mode"
            }>
            {agentModeEnabled ? (
              <Bot className="h-4 w-4" />
            ) : (
              <BotOff className="h-4 w-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          <div className="flex flex-col gap-0.5">
            <span className="font-semibold">
              {agentModeEnabled ? "Agent Mode ON" : "Agent Mode OFF"}
            </span>
            <span className="text-muted-foreground">
              {agentModeEnabled
                ? "LLM can interact with the page"
                : "Enable to let the LLM click and interact"}
            </span>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
