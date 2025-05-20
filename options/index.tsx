import { useState } from "react"

import { useStorage } from "@plasmohq/storage/hook"

import "../globals.css"

import ModelMenu from "@/components/model-menu"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { STORAGE_KEYS } from "@/lib/constant"

function OptionsIndex() {
  const [ollamaUrl, setOllamaUrl] = useStorage<string>(
    STORAGE_KEYS.OLLAMA.BASE_URL,
    "http://localhost:11434"
  )
  const [selectedModel] = useStorage<string>(
    STORAGE_KEYS.OLLAMA.SELECTED_MODEL,
    ""
  )
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div>
      <h1 className="mb-4 text-xl font-bold">Ollama Client Options</h1>

      <Label htmlFor="ollama-url" className="mb-1 block font-medium">
        Ollama Local URL:
      </Label>
      <div className="flex w-full">
        <Input
          id="ollama-url"
          type="text"
          value={ollamaUrl}
          onChange={(e) => setOllamaUrl(e.target.value)}
          placeholder="http://localhost:11434"
          className="w-1/4"
        />

        <Button onClick={handleSave}>Save</Button>

        {saved && <p className="mt-2 text-green-600">Saved!</p>}
      </div>
      <div className="mt-6">
        <Label className="font-medium">Selected Model:</Label>
        <p className="mt-1 text-sm text-gray-700">
          {selectedModel || "No model selected yet."}
        </p>
      </div>
      <ModelMenu />
    </div>
  )
}

export default OptionsIndex
