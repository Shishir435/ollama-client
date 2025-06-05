import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import { STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import ModelInfo from "@/features/model/components/model-info"
import ModelMenu from "@/features/model/components/model-menu"
import { OllamaStatusIndicator } from "@/features/model/components/ollama-status-indicator"
import { useModelConfig } from "@/features/model/hooks/use-model-config"

import { useStorage } from "@plasmohq/storage/hook"

export function ModelSettingsForm() {
  const [selectedModel] = useStorage<string>(
    { key: STORAGE_KEYS.OLLAMA.SELECTED_MODEL, instance: plasmoGlobalStorage },
    ""
  )

  const [config, updateConfig] = useModelConfig(selectedModel)
  const [newStop, setNewStop] = useState("")
  const [error, setError] = useState<string | null>(null)

  if (!selectedModel) return <div className="text-sm">No model selected.</div>

  const validateAndSet = (key: keyof typeof config, value: any) => {
    setError(null)
    if (key === "repeat_penalty" && (value <= 0 || isNaN(value))) {
      setError("Repeat penalty must be greater than 0.")
      return
    }
    if (key === "top_k" && (value < 1 || isNaN(value))) {
      setError("Top K must be a number greater than 0.")
      return
    }
    updateConfig({ [key]: value })
  }

  const handleAddStop = () => {
    const trimmed = newStop.trim()
    if (trimmed.length === 0) return
    if (config.stop.includes(trimmed)) return
    updateConfig({ stop: [...config.stop, trimmed] })
    setNewStop("")
  }

  const handleRemoveStop = (stopWord: string) => {
    updateConfig({ stop: config.stop.filter((s) => s !== stopWord) })
  }

  return (
    <Card className="space-y-4 p-4">
      <h2 className="flex items-center gap-4 text-lg font-semibold">
        Model Settings: <ModelMenu tooltipTextContent="Switch model" />{" "}
        <OllamaStatusIndicator />
      </h2>

      <ModelInfo selectedModel={selectedModel} />

      <div className="space-y-4 pt-2">
        {error && <p className="text-sm text-red-600">{error}</p>}

        <div>
          <Label htmlFor="temperature">Temperature</Label>
          <Slider
            id="temperature"
            min={0}
            max={1}
            step={0.01}
            value={[config.temperature]}
            onValueChange={([v]) => validateAndSet("temperature", v)}
          />
          <div className="mt-1 text-xs text-muted-foreground">
            {config.temperature}
          </div>
        </div>

        <div>
          <Label htmlFor="top_k">Top K</Label>
          <Input
            id="top_k"
            type="number"
            min={1}
            value={config.top_k}
            onChange={(e) => validateAndSet("top_k", parseInt(e.target.value))}
          />
        </div>

        <div>
          <Label htmlFor="top_p">Top P</Label>
          <Slider
            id="top_p"
            min={0}
            max={1}
            step={0.01}
            value={[config.top_p]}
            onValueChange={([v]) => validateAndSet("top_p", v)}
          />
          <div className="mt-1 text-xs text-muted-foreground">
            {config.top_p}
          </div>
        </div>

        <div>
          <Label htmlFor="repeat_penalty">Repeat Penalty</Label>
          <Input
            id="repeat_penalty"
            type="number"
            step={0.1}
            min={0.1}
            value={config.repeat_penalty}
            onChange={(e) =>
              validateAndSet("repeat_penalty", parseFloat(e.target.value))
            }
          />
        </div>

        <div>
          <Label htmlFor="system_prompt">System Prompt</Label>
          <Textarea
            id="system_prompt"
            value={config.system_prompt}
            onChange={(e) => updateConfig({ system_prompt: e.target.value })}
            placeholder="You are a helpful assistant..."
          />
        </div>

        <div>
          <Label>Stop Sequences</Label>
          <div className="mt-2 flex gap-2">
            <Input
              placeholder="Add stop sequence"
              value={newStop}
              onChange={(e) => setNewStop(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  handleAddStop()
                }
              }}
            />
            <Button onClick={handleAddStop} type="button" variant="outline">
              Add
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {config.stop.map((word) => (
              <div
                key={word}
                className="flex items-center gap-1 rounded bg-muted px-2 py-1 text-sm">
                {word}
                <button
                  onClick={() => handleRemoveStop(word)}
                  className="text-red-600 hover:underline"
                  type="button">
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  )
}
