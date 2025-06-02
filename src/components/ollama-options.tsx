import { useState } from "react"

import { CheckCircle2 } from "lucide-react"

import ExcludedUrls from "@/components/exclude-urls"
import ModelMenu from "@/components/model-menu"
import ThemeToggle from "@/components/theme-toggle"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { STORAGE_KEYS } from "@/lib/constant"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

import { useStorage } from "@plasmohq/storage/hook"

const OllamaOptions = () => {
  const [ollamaUrl, setOllamaUrl] = useStorage<string>(
    { key: STORAGE_KEYS.OLLAMA.BASE_URL, instance: plasmoGlobalStorage },
    "http://localhost:11434"
  )

  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  const tabSections = {
    general: {
      label: "General",
      content: (
        <div className="space-y-6">
          <div>
            <Label htmlFor="ollama-url">Local Ollama URL</Label>
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

          <div className="flex flex-wrap items-center gap-2">
            <Label className="whitespace-nowrap">Selected Model:</Label>
            <ModelMenu tooltipTextContent="Switch model" />
          </div>

          <div>
            <p className="mt-4 text-sm text-muted-foreground">
              ⚠️ <strong>Performance Notice:</strong> This extension is a user
              interface for your local Ollama server. Response time and model
              output quality depend entirely on your device's hardware (CPU,
              RAM, GPU) and the specific model you're using. No processing is
              done by the extension itself.
            </p>
          </div>
        </div>
      )
    },
    exclusions: {
      label: "Excluded URLs",
      content: <ExcludedUrls />
    },
    appearance: {
      label: "Appearance",
      content: (
        <div className="flex items-center justify-center gap-2">
          <ThemeToggle />
        </div>
      )
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Ollama Client Settings</CardTitle>
        <CardDescription>
          Configure your Ollama server, excluded sites, and appearance.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <Tabs defaultValue="general" className="w-full">
          <TabsList className="mb-4 flex h-auto flex-wrap gap-2">
            {Object.entries(tabSections).map(([key, tab]) => (
              <TabsTrigger key={key} value={key} className="flex-1">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {Object.entries(tabSections).map(([key, tab]) => (
            <TabsContent key={key} value={key} className="space-y-4">
              {tab.content}
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  )
}

export default OllamaOptions
