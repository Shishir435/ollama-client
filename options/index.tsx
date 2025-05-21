import { useState } from "react"

import { useStorage } from "@plasmohq/storage/hook"

import "../globals.css"

import ModelMenu from "@/components/model-menu"
import OllamaSetupInstructions from "@/components/ollama-setup-instructions"
import SocialHandles from "@/components/social-handles"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { STORAGE_KEYS } from "@/lib/constant"
import { CheckCircle2 } from "lucide-react"

function OptionsIndex() {
  const [ollamaUrl, setOllamaUrl] = useStorage<string>(
    STORAGE_KEYS.OLLAMA.BASE_URL,
    "http://localhost:11434"
  )
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div className="space-y-6 p-4 text-sm text-gray-900">
      <div className="fex-col flex flex-wrap items-center justify-center gap-8">
        <Card className="w-3/4">
          <CardHeader>
            <CardTitle>Ollama Client Options</CardTitle>
            <CardDescription>
              Set your local Ollama server URL and review selected model.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="ollama-url">Ollama Local URL</Label>
              <div className="mt-2 flex gap-2">
                <Input
                  id="ollama-url"
                  type="text"
                  value={ollamaUrl}
                  onChange={(e) => setOllamaUrl(e.target.value)}
                  placeholder="http://localhost:11434"
                  className="w-full"
                />
                <Button onClick={handleSave}>Save</Button>
              </div>
              {saved && (
                <div className="mt-2 flex items-center gap-1 text-sm text-green-600">
                  <CheckCircle2 size={16} /> <span>Saved!</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-4">
              <Label>Selected Model</Label>
              <ModelMenu />
            </div>
          </CardContent>
        </Card>
        <Card className="w-3/4">
          <CardHeader>
            <CardTitle>Configuration Guide</CardTitle>
            <CardDescription>
              Follow these steps to prevent CORS issues when using this
              extension with Ollama.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OllamaSetupInstructions />
          </CardContent>
        </Card>
      </div>

      <div className="mt-8 flex justify-center">
        <SocialHandles />
      </div>
    </div>
  )
}

export default OptionsIndex
