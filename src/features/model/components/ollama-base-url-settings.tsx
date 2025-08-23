import { useState } from "react"

import { Check, ExternalLink, Loader2, Server } from "lucide-react"

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
import { MESSAGE_KEYS, STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { cn } from "@/lib/utils"
import { useOllamaModels } from "@/features/model/hooks/use-ollama-models"

import { useStorage } from "@plasmohq/storage/hook"

export const BaseUrlSettings = () => {
  const [ollamaUrl, setOllamaUrl] = useStorage<string>(
    { key: STORAGE_KEYS.OLLAMA.BASE_URL, instance: plasmoGlobalStorage },
    "http://localhost:11434"
  )
  const { refresh } = useOllamaModels()
  const [isLoading, setIsLoading] = useState(false)

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
      setIsLoading(false)
      setTimeout(() => setSaved(false), 1500)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    e.stopPropagation()
    await handleSave()
  }

  const isValidUrl = (url) => {
    try {
      new URL(url)
      return true
    } catch {
      return false
    }
  }

  const urlIsValid = isValidUrl(ollamaUrl)
  const isLocalhost =
    ollamaUrl.includes("localhost") || ollamaUrl.includes("127.0.0.1")
  const isDefault = ollamaUrl === "http://localhost:11434"

  return (
    <div className="mx-auto space-y-4">
      <Card className="w-full">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="mb-2 flex items-center gap-2">
              <Server className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-xl">Ollama Base URL</CardTitle>
            </div>
            {isDefault && (
              <Badge variant="secondary" className="ml-auto text-xs">
                Default
              </Badge>
            )}
            {!isLocalhost && urlIsValid && (
              <Badge variant="outline" className="ml-auto text-xs">
                <ExternalLink className="mr-1 h-3 w-3" />
                Remote
              </Badge>
            )}
          </div>
          <CardDescription>
            Configure the server endpoint for your Ollama installation
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label
              htmlFor="ollama-url"
              className="flex items-center justify-between text-sm text-muted-foreground">
              <div className="text-sm">Server endpoint for Ollama API</div>
              {!urlIsValid && ollamaUrl && (
                <p className="flex items-center gap-1 text-xs text-destructive">
                  <span className="inline-block h-1 w-1 rounded-full bg-destructive" />
                  Please enter a valid URL format
                </p>
              )}
              {urlIsValid && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <p className="h-1 w-1 rounded-full bg-green-500" />
                  {isLocalhost
                    ? "Local server connection"
                    : "Remote server connection"}
                </div>
              )}
            </Label>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="ollama-url"
                  type="text"
                  value={ollamaUrl}
                  onChange={(e) => setOllamaUrl(e.target.value)}
                  placeholder="http://localhost:11434"
                  className={cn(
                    "pr-8 font-mono text-sm",
                    !urlIsValid && ollamaUrl && "border-destructive",
                    saved && "border-green-600 bg-green-50/50"
                  )}
                  disabled={isLoading}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      handleSubmit(e)
                    }
                  }}
                />
                {saved && (
                  <Check className="absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-green-600" />
                )}
              </div>

              <Button
                onClick={handleSubmit}
                disabled={!urlIsValid || isLoading || saved}
                className={cn(
                  "min-w-[80px] transition-all",
                  saved && "bg-green-600 text-white hover:bg-green-700"
                )}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    Saving
                  </>
                ) : saved ? (
                  <>
                    <Check className="mr-1 h-4 w-4" />
                    Saved
                  </>
                ) : (
                  "Save"
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
