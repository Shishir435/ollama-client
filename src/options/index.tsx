import { TooltipProvider } from "@/components/ui/tooltip"
import { OllamaOptions } from "@/options/components/ollama-options"

import "../globals.css"

import { useThemeWatcher } from "@/hooks/use-theme-watcher"

export const OptionsIndex = () => {
  useThemeWatcher()
  return (
    <TooltipProvider>
      <OllamaOptions />
    </TooltipProvider>
  )
}

export default OptionsIndex
