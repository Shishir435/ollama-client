import { useEffect } from "react"

import {
  AlertTriangle,
  CheckCircle,
  Loader2,
  RefreshCw,
  XCircle
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { useOllamaModels } from "@/features/model/hooks/use-ollama-models"

export function OllamaStatusIndicator() {
  const { status, refresh, error } = useOllamaModels()

  useEffect(() => {
    // Auto-refresh every 10 seconds
    const interval = setInterval(() => {
      refresh()
    }, 10_000)

    return () => clearInterval(interval)
  }, [refresh])

  const iconMap = {
    loading: <Loader2 className="h-4 w-4 animate-spin text-yellow-500" />,
    error: <XCircle className="h-4 w-4 text-red-500" />,
    empty: <AlertTriangle className="h-4 w-4 text-orange-500" />,
    ready: <CheckCircle className="h-4 w-4 text-green-600" />
  }

  const labelMap = {
    loading: "Checking Ollama status...",
    error: "Ollama not reachable",
    empty: "No models found",
    ready: "Ollama is ready"
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="secondary"
          size="icon"
          onClick={refresh}
          className="m-1 rounded-xl border border-border/50 bg-background/50 shadow-sm backdrop-blur-sm transition-all duration-200 hover:bg-accent/50">
          {iconMap[status]}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left">
        <div className="flex items-center gap-2 text-sm">
          <span>{labelMap[status]}</span>
          {status !== "loading" && (
            <RefreshCw
              className="h-3.5 w-3.5 cursor-pointer text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation()
                refresh()
              }}
            />
          )}
        </div>
        {status === "error" && error && (
          <div className="mt-1 max-w-xs text-xs text-red-500">{error}</div>
        )}
      </TooltipContent>
    </Tooltip>
  )
}
