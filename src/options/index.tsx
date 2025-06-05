import { TooltipProvider } from "@/components/ui/tooltip"
import { ThemeProvider } from "@/context/them-provider-context"
import { STORAGE_KEYS } from "@/lib/constants"
import OptionsPage from "@/options/components/options-page"

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
