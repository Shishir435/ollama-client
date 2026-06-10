import { useStorage } from "@plasmohq/storage/hook"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { FieldStack } from "@/components/layout"
import {
  SettingsActionRow,
  SettingsCard,
  SettingsFormField
} from "@/components/settings"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useProviderModels } from "@/features/model/hooks/use-provider-models"
import { MESSAGE_KEYS, STORAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import { Check, ExternalLink, Loader2, Server } from "@/lib/lucide-icon"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { sendRuntimeMessage } from "@/lib/runtime-messages"
import { cn } from "@/lib/utils"

export const ProviderBaseUrlSettings = () => {
  const { t } = useTranslation()
  const [storageUrl, setStorageUrl] = useStorage<string>(
    { key: STORAGE_KEYS.PROVIDER.BASE_URL, instance: plasmoGlobalStorage },
    "http://localhost:11434"
  )
  // Local state for input to prevent cursor jumping
  const [providerUrl, setProviderUrl] = useState(storageUrl)
  const { refresh } = useProviderModels()
  const [isLoading, setIsLoading] = useState(false)

  const [saved, setSaved] = useState(false)

  // Sync local state with storage when it changes externally
  useEffect(() => {
    setProviderUrl(storageUrl)
  }, [storageUrl])

  const handleSave = async () => {
    setIsLoading(true)
    try {
      // Update storage first
      await setStorageUrl(providerUrl)
      await sendRuntimeMessage(MESSAGE_KEYS.PROVIDER.UPDATE_BASE_URL, {
        payload: providerUrl
      })
      setSaved(true)
      refresh()
      logger.info(
        "Base URL updated and DNR rule applied",
        "ProviderBaseUrlSettings"
      )
    } catch (err) {
      logger.error("Failed to update base URL", "ProviderBaseUrlSettings", {
        error: err
      })
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

  const urlIsValid = isValidUrl(providerUrl)
  const isLocalhost =
    providerUrl.includes("localhost") || providerUrl.includes("127.0.0.1")
  const isDefault = providerUrl === "http://localhost:11434"

  return (
    <FieldStack>
      <SettingsCard
        className="w-full"
        icon={Server}
        title={t("settings.base_url.title")}
        description={t("settings.base_url.description")}
        contentClassName="space-y-3"
        headerActions={
          <>
            {isDefault && (
              <Badge variant="secondary" className="ml-auto text-xs">
                {t("settings.base_url.badges.default")}
              </Badge>
            )}
            {!isLocalhost && urlIsValid && (
              <Badge variant="outline" className="ml-auto text-xs">
                <ExternalLink className="mr-1 icon-xs" />
                {t("settings.base_url.badges.remote")}
              </Badge>
            )}
          </>
        }>
        <FieldStack className="space-y-2">
          <SettingsFormField
            htmlFor="provider-url"
            label={
              <div className="flex items-center justify-between w-full">
                <div className="text-sm">{t("settings.base_url.label")}</div>
                {!urlIsValid && providerUrl && (
                  <p className="flex items-center gap-1 text-xs text-destructive">
                    <span className="inline-block size-1 rounded-full bg-destructive" />
                    {t("settings.base_url.error_invalid_url")}
                  </p>
                )}
                {urlIsValid && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <p className="size-1 rounded-full bg-status-success" />
                    {isLocalhost
                      ? t("settings.base_url.status_local")
                      : t("settings.base_url.status_remote")}
                  </div>
                )}
              </div>
            }
            labelClassName="text-muted-foreground pb-1">
            <SettingsActionRow>
              <div className="relative flex-1">
                <Input
                  id="provider-url"
                  type="text"
                  value={providerUrl}
                  onChange={(e) => setProviderUrl(e.target.value)}
                  placeholder="http://localhost:11434"
                  className={cn(
                    "pr-8 font-mono text-sm",
                    !urlIsValid && providerUrl && "border-destructive",
                    saved && "border-status-success bg-status-success/10"
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
                  <Check className="absolute right-2 top-1/2 icon-md -translate-y-1/2 text-status-success" />
                )}
              </div>
              <Button
                onClick={handleSubmit}
                disabled={!urlIsValid || isLoading || saved}
                className={cn(
                  "min-w-20 transition-all",
                  saved &&
                    "bg-status-success text-status-success-foreground hover:bg-status-success/90"
                )}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-1 icon-md animate-spin" />
                    {t("settings.base_url.button.saving")}
                  </>
                ) : saved ? (
                  <>
                    <Check className="mr-1 icon-md" />
                    {t("settings.base_url.button.saved")}
                  </>
                ) : (
                  t("settings.base_url.button.save")
                )}
              </Button>
            </SettingsActionRow>
          </SettingsFormField>
        </FieldStack>
      </SettingsCard>
    </FieldStack>
  )
}
