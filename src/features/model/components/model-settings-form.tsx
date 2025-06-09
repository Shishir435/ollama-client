import { useState } from "react"

import ThemeToggle from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import { STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import LoadedModelsInfo from "@/features/model/components/loaded-models-info"
import ModelInfo from "@/features/model/components/model-info"
import ModelMenu from "@/features/model/components/model-menu"
import BaseUrlSettings from "@/features/model/components/ollama-base-url-settings"
import { OllamaStatusIndicator } from "@/features/model/components/ollama-status-indicator"
import { OllamaVersion } from "@/features/model/components/ollama-version"
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

  if (!selectedModel) {
    return (
      <Card className="space-y-4 p-4">
        <h2 className="text-lg font-semibold">Model Settings</h2>
        <p className="text-sm text-muted-foreground">No model selected.</p>
        <BaseUrlSettings />
      </Card>
    )
  }

  const validateAndSet = (key: keyof typeof config, value: any) => {
    setError(null)
    if (key === "repeat_penalty" && (value <= 0 || isNaN(value))) {
      setError("Repeat penalty must be greater than 0.")
      return
    }
    if (
      (key === "top_k" ||
        key === "num_ctx" ||
        key === "repeat_last_n" ||
        key === "num_predict") &&
      (value < 0 || isNaN(value))
    ) {
      setError(`${key} must be a number greater than or equal to 0.`)
      return
    }
    updateConfig({ [key]: value })
  }

  const handleAddStop = () => {
    const trimmed = newStop.trim()
    if (trimmed.length === 0 || config.stop.includes(trimmed)) return
    updateConfig({ stop: [...config.stop, trimmed] })
    setNewStop("")
  }

  const handleRemoveStop = (stopWord: string) => {
    updateConfig({ stop: config.stop.filter((s) => s !== stopWord) })
  }

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-4 text-lg font-semibold">
        <h2 className="flex flex-wrap items-center gap-4">
          Model Settings:
          <ModelMenu tooltipTextContent="Switch model" />
          <ThemeToggle />
        </h2>
        <div className="flex items-center gap-4">
          <OllamaStatusIndicator />
          <OllamaVersion />
        </div>
      </div>
      <ModelInfo selectedModel={selectedModel} />
      <LoadedModelsInfo />

      <div className="space-y-4 pt-2">
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div>
          <Label htmlFor="system">System Prompt</Label>
          <Textarea
            id="system"
            placeholder="Enter a custom system prompt for this model"
            value={config.system}
            onChange={(e) => validateAndSet("system", e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="stop-sequences">Stop Sequences</Label>
          <div className="flex gap-2">
            <Input
              id="stop-sequences"
              value={newStop}
              placeholder="Add stop word"
              onChange={(e) => setNewStop(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddStop()}
            />
            <Button type="button" onClick={handleAddStop}>
              Add
            </Button>
          </div>
          {config.stop.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2 text-sm">
              {config.stop.map((word) => (
                <li key={word} className="rounded bg-muted px-2 py-1">
                  {word}
                  <button
                    className="ml-2 text-red-500 hover:text-red-700"
                    onClick={() => handleRemoveStop(word)}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="seed">Seed</Label>
            <Input
              id="seed"
              type="number"
              min={0}
              value={config.seed}
              onChange={(e) => validateAndSet("seed", parseInt(e.target.value))}
            />
          </div>
          <div>
            <BaseUrlSettings />
          </div>
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
            <Label htmlFor="top_k">Top K</Label>
            <Input
              id="top_k"
              type="number"
              min={1}
              value={config.top_k}
              onChange={(e) =>
                validateAndSet("top_k", parseInt(e.target.value))
              }
            />
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
            <Label htmlFor="num_ctx">Context Size</Label>
            <Input
              id="num_ctx"
              type="number"
              min={128}
              value={config.num_ctx}
              onChange={(e) =>
                validateAndSet("num_ctx", parseInt(e.target.value))
              }
            />
          </div>

          <div>
            <Label htmlFor="repeat_last_n">Repeat Last N</Label>
            <Input
              id="repeat_last_n"
              type="number"
              min={-1}
              value={config.repeat_last_n}
              onChange={(e) =>
                validateAndSet("repeat_last_n", parseInt(e.target.value))
              }
            />
          </div>

          <div>
            <Label htmlFor="num_predict">Max Tokens (num_predict)</Label>
            <Input
              id="num_predict"
              type="number"
              value={config.num_predict}
              onChange={(e) =>
                validateAndSet("num_predict", parseInt(e.target.value))
              }
            />
          </div>

          <div>
            <Label htmlFor="min_p">Min P</Label>
            <Input
              id="min_p"
              type="number"
              step={0.01}
              min={0.0}
              max={1.0}
              value={config.min_p}
              onChange={(e) =>
                validateAndSet("min_p", parseFloat(e.target.value))
              }
            />
          </div>
        </div>
      </div>
    </Card>
  )
}
