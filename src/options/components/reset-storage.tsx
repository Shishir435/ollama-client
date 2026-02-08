import { useState } from "react"
import { useTranslation } from "react-i18next"

import { SettingsCard, StatusAlert } from "@/components/settings"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { useResetAppStorage } from "@/hooks/use-reset-app-storage"
import { getAllResetKeys } from "@/lib/get-all-reset-keys"
import { CircleCheck, RefreshCcw } from "@/lib/lucide-icon"

export const ResetStorage = () => {
  const { t } = useTranslation()
  const reset = useResetAppStorage()
  const keysByModule = getAllResetKeys()
  const [open, setOpen] = useState(false)

  const handleResetAll = async () => {
    await reset("all")
    setOpen(false)
  }

  const getModuleIcon = (module: string) => {
    switch (module) {
      case "PROVIDER":
        return "🔌"
      case "THEME":
        return "🎨"
      case "BROWSER":
        return "🌐"
      case "TTS":
        return "🔊"
      case "CHAT_SESSIONS":
        return "💬"
      default:
        return "⚙️"
    }
  }

  const getModuleDescription = (module: string) => {
    switch (module) {
      case "PROVIDER":
        return t("settings.reset.modules.provider.description")
      case "THEME":
        return t("settings.reset.modules.theme.description")
      case "BROWSER":
        return t("settings.reset.modules.browser.description")
      case "TTS":
        return t("settings.reset.modules.tts.description")
      case "CHAT_SESSIONS":
        return t("settings.reset.modules.chat_sessions.description")
      default:
        return t("settings.reset.modules.default.description")
    }
  }

  return (
    <div className="mx-auto space-y-4">
      <SettingsCard
        icon={RefreshCcw}
        title={t("settings.reset.title")}
        description={t("settings.reset.description")}>
        <div className="grid gap-3">
          {Object.entries(keysByModule).map(([module, keys]) => (
            <ModuleResetItem
              key={module}
              module={module}
              keys={keys}
              getModuleIcon={getModuleIcon}
              getModuleDescription={getModuleDescription}
              reset={reset}
            />
          ))}
        </div>

        <Separator />

        <StatusAlert
          variant="destructive"
          icon={RefreshCcw}
          title={t("settings.reset.danger_zone.title")}
          description={t("settings.reset.danger_zone.description")}
          actions={
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button variant="destructive" className="w-full sm:w-auto">
                  {t("settings.reset.danger_zone.button")}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t("settings.reset.dialog.title")}</DialogTitle>
                  <DialogDescription>
                    {t("settings.reset.dialog.description")}
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter className="flex flex-col gap-4">
                  <Button variant="destructive" onClick={handleResetAll}>
                    {t("settings.reset.dialog.confirm")}
                  </Button>
                  <Button variant="secondary" onClick={() => setOpen(false)}>
                    {t("settings.reset.dialog.cancel")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          }
        />
      </SettingsCard>
    </div>
  )
}

const ModuleResetItem = ({
  module,
  keys,
  getModuleIcon,
  getModuleDescription,
  reset
}: {
  module: string
  keys: string[]
  getModuleIcon: (module: string) => string
  getModuleDescription: (module: string) => string
  reset: (key: string) => Promise<string>
}) => {
  const { t } = useTranslation()
  const [resetting, setResetting] = useState(false)

  return (
    <div className="flex items-center justify-between rounded-lg border bg-card p-3 transition-colors hover:bg-accent/50">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex-shrink-0 text-lg">{getModuleIcon(module)}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium">{module.replace("_", " ")}</h4>
            <Badge variant="secondary" className="text-xs">
              {keys.length === 1
                ? t("settings.reset.item_count", { count: keys.length })
                : t("settings.reset.item_count_plural", { count: keys.length })}
            </Badge>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {getModuleDescription(module)}
          </p>
        </div>
      </div>
      <Button
        size="sm"
        variant="ghost"
        onClick={async () => {
          setResetting(true)
          await reset(module)
          setTimeout(() => setResetting(false), 1000)
        }}>
        {t("settings.reset.reset_button")}{" "}
        {resetting ? <CircleCheck className="h-4 w-4" /> : ""}
      </Button>
    </div>
  )
}
