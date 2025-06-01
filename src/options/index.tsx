import OptionsPage from "@/components/options-page"
import { ThemeProvider } from "@/components/them-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { STORAGE_KEYS } from "@/lib/constant"

import "../globals.css"

function OptionsIndex() {
  return (
    <ThemeProvider storageKey={STORAGE_KEYS.THEME.PREFERENCE}>
      <TooltipProvider>
        <OptionsPage />
      </TooltipProvider>
    </ThemeProvider>
  )
}

export default OptionsIndex
