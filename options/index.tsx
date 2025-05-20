import { useStorage } from "@plasmohq/storage/hook"
import { useState } from "react"
import "../globals.css"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { STORAGE_KEYS } from "@/lib/constant"

function OptionsIndex() {
  const [ollamaUrl, setOllamaUrl] = useStorage<string>(STORAGE_KEYS.OLLAMA.BASE_URL, "http://localhost:11434")
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">Ollama Client Options</h1>

      <Label htmlFor="ollama-url" className="block font-medium mb-1">
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

      <Button onClick={handleSave}>
        Save
      </Button>

      {saved && <p className="text-green-600 mt-2">Saved!</p>}
    </div>
    </div>
  )
}

export default OptionsIndex
