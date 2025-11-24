import { useStorage } from "@plasmohq/storage/hook"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
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
import { useOllamaModels } from "@/features/model/hooks/use-ollama-models"
import { browser } from "@/lib/browser-api"
import { MESSAGE_KEYS, STORAGE_KEYS } from "@/lib/constants"
import { Check, ExternalLink, Loader2, Server } from "@/lib/lucide-icon"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { cn } from "@/lib/utils"

export const BaseUrlSettings = () => {
  const { t } = useTranslation()
  const [storageUrl, setStorageUrl] = useStorage<string>(
    { key: STORAGE_KEYS.OLLAMA.BASE_URL, instance: plasmoGlobalStorage },
    "http://localhost:11434"
  )
  // Local state for input to prevent cursor jumping
  const [ollamaUrl, setOllamaUrl] = useState(storageUrl)
  const { refresh } = useOllamaModels()
  const [isLoading, setIsLoading] = useState(false)

  const [saved, setSaved] = useState(false)

  // Sync local state with storage when it changes externally
  useEffect(() => {
    setOllamaUrl(storageUrl)
  }, [storageUrl])

  const handleSave = async () => {
    setIsLoading(true)
    try {
      // Update storage first
      await setStorageUrl(ollamaUrl)
      await browser.runtime.sendMessage({
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
              <CardTitle className="text-xl">
                {t("settings.base_url.title")}
              </CardTitle>
            </div>
            {isDefault && (
              <Badge variant="secondary" className="ml-auto text-xs">
                {t("settings.base_url.badges.default")}
              </Badge>
            )}
            {!isLocalhost && urlIsValid && (
              <Badge variant="outline" className="ml-auto text-xs">
                <ExternalLink className="mr-1 h-3 w-3" />
                {t("settings.base_url.badges.remote")}
              </Badge>
            )}
          </div>
          <CardDescription>
            {t("settings.base_url.description")}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label
              htmlFor="ollama-url"
              className="flex items-center justify-between text-sm text-muted-foreground">
              <div className="text-sm">{t("settings.base_url.label")}</div>
              {!urlIsValid && ollamaUrl && (
                <p className="flex items-center gap-1 text-xs text-destructive">
                  <span className="inline-block h-1 w-1 rounded-full bg-destructive" />
                  {t("settings.base_url.error_invalid_url")}
                </p>
              )}
              {urlIsValid && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <p className="h-1 w-1 rounded-full bg-green-500" />
                  {isLocalhost
                    ? t("settings.base_url.status_local")
                    : t("settings.base_url.status_remote")}
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
                    {t("settings.base_url.button.saving")}
                  </>
                ) : saved ? (
                  <>
                    <Check className="mr-1 h-4 w-4" />
                    {t("settings.base_url.button.saved")}
                  </>
                ) : (
                  t("settings.base_url.button.save")
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
