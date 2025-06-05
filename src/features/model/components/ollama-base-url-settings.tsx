import { useState } from "react"

import { CheckCircle2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MESSAGE_KEYS, STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { useOllamaModels } from "@/features/model/hooks/use-ollama-models"

import { useStorage } from "@plasmohq/storage/hook"

export default function BaseUrlSettings() {
  const [ollamaUrl, setOllamaUrl] = useStorage<string>(
    { key: STORAGE_KEYS.OLLAMA.BASE_URL, instance: plasmoGlobalStorage },
    "http://localhost:11434"
  )
  const { refresh } = useOllamaModels()

  const [saved, setSaved] = useState(false)

  const handleSave = async () => {
    try {
      await chrome.runtime.sendMessage({
        type: MESSAGE_KEYS.OLLAMA.UPDATE_BASE_URL,
        payload: ollamaUrl
      })
      setSaved(true)
      refresh()

      console.log("Base URL updated and DNR rule applied")
    } catch (err) {
      console.error("Failed to update base URL:", err)
    } finally {
      setTimeout(() => setSaved(false), 1500)
    }
  }

  return (
    <div>
      <Label htmlFor="ollama-url" className="text-sm">
        Local Ollama URL
      </Label>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <Input
          id="ollama-url"
          type="text"
          value={ollamaUrl}
          onChange={(e) => setOllamaUrl(e.target.value)}
          placeholder="http://localhost:11434"
        />
        <Button onClick={handleSave} className="w-full sm:w-auto">
          Save
        </Button>
      </div>
      {saved && (
        <div className="mt-2 flex items-center gap-1 text-sm text-green-600">
          <CheckCircle2 size={16} /> <span>Saved!</span>
        </div>
      )}
    </div>
  )
}
