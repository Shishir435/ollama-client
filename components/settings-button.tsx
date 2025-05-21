import { Button } from "@/components/ui/button"
import { Settings } from "lucide-react"

function SettingsButton() {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => {
        chrome.runtime.openOptionsPage()
      }}>
      <Settings size="16" className="opacity-80" />
    </Button>
  )
}

export default SettingsButton
