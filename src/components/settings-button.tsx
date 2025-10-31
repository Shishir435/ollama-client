import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import browser from "@/lib/browser-api"
import { Settings } from "@/lib/lucide-icon"

export const SettingsButton = ({ showText = true }: { showText?: boolean }) => {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="link"
          size="sm"
          onClick={() => {
            browser.runtime.openOptionsPage()
          }}
          aria-label="Extension Settings">
          <Settings size="16" className="opacity-80" />
          {showText && <span>Setting</span>}
        </Button>
      </TooltipTrigger>
      <TooltipContent>Extension Settings</TooltipContent>
    </Tooltip>
  )
}
