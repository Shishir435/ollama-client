import { useState } from "react"

import {
  Brain,
  Eye,
  Hash,
  Layers,
  MessageSquare,
  Settings,
  StopCircle,
  Target,
  Thermometer
} from "lucide-react"

import { ThemeToggle } from "@/components/theme-toggle"
import { Badge } from "@/components/ui/badge"
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
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import { STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { LoadedModelsInfo } from "@/features/model/components/loaded-models-info"
import { ModelInfo } from "@/features/model/components/model-info"
import { ModelMenu } from "@/features/model/components/model-menu"
import { BaseUrlSettings } from "@/features/model/components/ollama-base-url-settings"
import { OllamaStatusIndicator } from "@/features/model/components/ollama-status-indicator"
import { OllamaVersion } from "@/features/model/components/ollama-version"
import { useModelConfig } from "@/features/model/hooks/use-model-config"

import { useStorage } from "@plasmohq/storage/hook"

export const ModelSettingsForm = () => {
  const [selectedModel] = useStorage<string>(
    { key: STORAGE_KEYS.OLLAMA.SELECTED_MODEL, instance: plasmoGlobalStorage },
    ""
  )

  const [config, updateConfig] = useModelConfig(selectedModel)
  const [newStop, setNewStop] = useState("")
  const [error, setError] = useState<string | null>(null)

  if (!selectedModel) {
    return (
      <div className="mx-auto space-y-4">
        <Card>
          <CardHeader>
            <div className="mb-2 flex items-center gap-2">
              <Settings className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-2xl">Model Settings</CardTitle>
            </div>
            <CardDescription>
              Configure your AI model parameters
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ModelMenu tooltipTextContent="Choose model" />
            <BaseUrlSettings />
          </CardContent>
        </Card>
      </div>
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
    <div className="mx-auto space-y-4">
      <Card className="border-2 bg-gradient-to-r from-background to-muted/20">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="mb-2 flex items-center gap-2">
              <Settings className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-xl">Model Settings</CardTitle>
            </div>
            <div className="flex items-center gap-3">
              <ModelMenu tooltipTextContent="Switch model" />
              <ThemeToggle />
              <OllamaStatusIndicator />
              <OllamaVersion />
            </div>
          </div>
          <CardDescription>
            Configure parameters for optimal performance
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ModelInfo selectedModel={selectedModel} />
          <LoadedModelsInfo />
        </CardContent>
      </Card>

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-4">
            <p className="flex items-center gap-2 text-sm text-red-600">
              <StopCircle className="h-4 w-4" />
              {error}
            </p>
          </CardContent>
        </Card>
      )}

      <BaseUrlSettings />

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-xl">System Configuration</CardTitle>
          </div>
          <CardDescription>
            Configure system prompts and stop sequences to control model
            behavior
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <Label htmlFor="system" className="text-base font-medium">
              System Prompt
            </Label>
            <Textarea
              id="system"
              placeholder="Enter a custom system prompt to guide the model's behavior..."
              value={config.system}
              onChange={(e) => validateAndSet("system", e.target.value)}
              className="min-h-[100px] resize-none"
            />
          </div>
          <Separator />
          <div className="space-y-3">
            <Label
              htmlFor="stop-sequences"
              className="flex items-center gap-2 text-base font-medium">
              <StopCircle className="h-4 w-4" />
              Stop Sequences
            </Label>
            <div className="flex gap-2">
              <Input
                id="stop-sequences"
                value={newStop}
                placeholder="Enter stop sequence..."
                onChange={(e) => setNewStop(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddStop()}
                className="flex-1"
              />
              <Button type="button" onClick={handleAddStop}>
                Add
              </Button>
            </div>
            {config.stop.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {config.stop.map((word) => (
                  <Badge
                    key={word}
                    variant="secondary"
                    className="px-3 py-1 text-xs">
                    {word}
                    <button
                      className="ml-2 text-muted-foreground transition-colors hover:text-destructive"
                      onClick={() => handleRemoveStop(word)}>
                      ×
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-xl">Sampling Parameters</CardTitle>
            </div>
            <CardDescription>
              Control randomness and token selection
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <Label htmlFor="temperature" className="flex items-center gap-2">
                <Thermometer className="h-4 w-4" />
                Temperature
              </Label>
              <Slider
                id="temperature"
                min={0}
                max={1}
                step={0.01}
                value={[config.temperature]}
                onValueChange={([v]) => validateAndSet("temperature", v)}
                className="py-2"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Conservative</span>
                <Badge variant="outline" className="font-mono">
                  {config.temperature}
                </Badge>
                <span>Creative</span>
              </div>
            </div>

            <div className="space-y-3">
              <Label htmlFor="top_p" className="flex items-center gap-2">
                <Eye className="h-4 w-4" />
                Top P (Nucleus)
              </Label>
              <Slider
                id="top_p"
                min={0}
                max={1}
                step={0.01}
                value={[config.top_p]}
                onValueChange={([v]) => validateAndSet("top_p", v)}
                className="py-2"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Focused</span>
                <Badge variant="outline" className="font-mono">
                  {config.top_p}
                </Badge>
                <span>Diverse</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label
                  htmlFor="top_k"
                  className="flex items-center gap-2 text-sm">
                  <Hash className="h-3 w-3" />
                  Top K
                </Label>
                <Input
                  id="top_k"
                  type="number"
                  min={1}
                  value={config.top_k}
                  onChange={(e) =>
                    validateAndSet("top_k", parseInt(e.target.value))
                  }
                  className="text-center"
                />
              </div>

              <div className="space-y-2">
                <Label
                  htmlFor="min_p"
                  className="flex items-center gap-2 text-sm">
                  <Layers className="h-3 w-3" />
                  Min P
                </Label>
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
                  className="text-center"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-xl">Context & Generation</CardTitle>
            </div>
            <CardDescription>
              Memory and output control settings
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="seed" className="text-sm">
                  Seed
                </Label>
                <Input
                  id="seed"
                  type="number"
                  min={0}
                  value={config.seed}
                  onChange={(e) =>
                    validateAndSet("seed", parseInt(e.target.value))
                  }
                  className="text-center"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="num_ctx" className="text-sm">
                  Context Size
                </Label>
                <Input
                  id="num_ctx"
                  type="number"
                  min={128}
                  value={config.num_ctx}
                  onChange={(e) =>
                    validateAndSet("num_ctx", parseInt(e.target.value))
                  }
                  className="text-center"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="num_predict" className="text-sm">
                  Max Tokens
                </Label>
                <Input
                  id="num_predict"
                  type="number"
                  value={config.num_predict}
                  onChange={(e) =>
                    validateAndSet("num_predict", parseInt(e.target.value))
                  }
                  className="text-center"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="repeat_penalty" className="text-sm">
                  Repeat Penalty
                </Label>
                <Input
                  id="repeat_penalty"
                  type="number"
                  step={0.1}
                  min={0.1}
                  value={config.repeat_penalty}
                  onChange={(e) =>
                    validateAndSet("repeat_penalty", parseFloat(e.target.value))
                  }
                  className="text-center"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="repeat_last_n" className="text-sm">
                Repeat Last N
              </Label>
              <Input
                id="repeat_last_n"
                type="number"
                min={-1}
                value={config.repeat_last_n}
                onChange={(e) =>
                  validateAndSet("repeat_last_n", parseInt(e.target.value))
                }
                className="text-center"
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
