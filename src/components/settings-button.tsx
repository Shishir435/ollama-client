import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { Settings } from "lucide-react"

function SettingsButton() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="link"
          size="sm"
          onClick={() => {
            chrome.runtime.openOptionsPage()
          }}
          aria-label="Extension Settings">
          <Settings size="16" className="opacity-80" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Extension Settings</TooltipContent>
    </Tooltip>
  )
}

export default SettingsButton
