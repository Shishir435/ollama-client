import { TooltipProvider } from "@/components/ui/tooltip"
import { OllamaOptions } from "@/options/components/ollama-options"

import "../globals.css"
import "@/i18n/config"

import { useLanguageSync } from "@/hooks/use-language-sync"
import { useThemeWatcher } from "@/hooks/use-theme-watcher"

export const OptionsIndex = () => {
  useThemeWatcher()
  useLanguageSync()
  return (
    <TooltipProvider>
      <OllamaOptions />
    </TooltipProvider>
  )
}

export default OptionsIndex
