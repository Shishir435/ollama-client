import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MESSAGE_KEYS, STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { cn } from "@/lib/utils"
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    e.stopPropagation()
    await handleSave()
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-1.5">
        <Label htmlFor="ollama-url" className="text-sm">
          Ollama URL
        </Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="ollama-url"
            type="text"
            value={ollamaUrl}
            onChange={(e) => setOllamaUrl(e.target.value)}
            placeholder="http://localhost:11434"
          />
          <Button
            type="submit"
            className={cn(
              saved && "border-green-200 bg-green-50 !text-green-500"
            )}>
            {saved ? "Saved!" : "Save"}
          </Button>
        </div>
      </div>
    </form>
  )
}
