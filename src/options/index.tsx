import { TooltipProvider } from "@/components/ui/tooltip"
import { ThemeProvider } from "@/context/them-provider-context"
import { STORAGE_KEYS } from "@/lib/constants"
import OllamaOptions from "@/options/components/ollama-options"

import "../globals.css"

function OptionsIndex() {
  return (
    <ThemeProvider storageKey={STORAGE_KEYS.THEME.PREFERENCE}>
      <TooltipProvider>
        <OllamaOptions />
      </TooltipProvider>
    </ThemeProvider>
  )
}

export default OptionsIndex
