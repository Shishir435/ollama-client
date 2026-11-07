import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { CopyButton } from "@/features/chat/components/copy-button"
import {
  detectOllamaHostOs,
  OLLAMA_ORIGINS_COMMANDS,
  type OllamaHostOs
} from "@/lib/onboarding/provider-connection"

const OS_OPTIONS: OllamaHostOs[] = ["macos", "windows", "linux"]

/**
 * The command that lets Ollama accept this extension's origin, with a copy
 * action and a short OS selector: the desktop apps on macOS and Windows own
 * the port, so `ollama serve` only works on Linux. Shown wherever a connection
 * test reports the origin block.
 */
export const OllamaOriginsCommand = () => {
  const { t } = useTranslation()
  const [os, setOs] = useState<OllamaHostOs>(() => detectOllamaHostOs())
  const command = OLLAMA_ORIGINS_COMMANDS[os]

  return (
    <div className="flex flex-col gap-2">
      <fieldset className="flex gap-1">
        <legend className="sr-only">
          {t("onboarding.provider.origins.os_label")}
        </legend>
        {OS_OPTIONS.map((option) => (
          <Button
            key={option}
            type="button"
            size="sm"
            variant={option === os ? "secondary" : "ghost"}
            aria-pressed={option === os}
            onClick={() => setOs(option)}>
            {t(`onboarding.provider.origins.${option}`)}
          </Button>
        ))}
      </fieldset>
      {os !== "linux" && (
        <p className="text-xs text-muted-foreground">
          {t("onboarding.provider.origins.quit_first")}
        </p>
      )}
      <div className="flex items-center gap-1 rounded-control bg-muted p-2 text-foreground">
        <code className="min-w-0 flex-1 break-all font-mono text-xs select-all">
          {command}
        </code>
        <CopyButton text={command} />
      </div>
      <p className="text-xs text-muted-foreground">
        {t(`onboarding.provider.origins.${os}_steps`)}
      </p>
    </div>
  )
}
