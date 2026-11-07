import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { chatInputStore } from "@/features/chat/stores/chat-input-store"
import { useProviderModels } from "@/features/model/hooks/use-provider-models"
import { ProviderStatusCard } from "./provider-status-card"

const PROMPT_KEYS = ["summarize", "explain", "file", "brainstorm"] as const

/** What an empty chat shows above the composer: the product, and any blocker. */
export const ChatEmptyState = () => {
  const { t } = useTranslation()
  const { status } = useProviderModels()

  /** A chip fills the composer and focuses it; it never sends on its own. */
  const fillComposer = (text: string) => {
    const store = chatInputStore.getState()
    store.setInput(text)
    store.requestFocus()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-auto px-4 py-6 scrollbar-none">
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {t("welcome.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("welcome.subtitle")}</p>
      </div>
      <ProviderStatusCard />
      {status === "ready" && (
        <div className="flex w-full max-w-sm flex-col items-center gap-3">
          <fieldset className="flex min-w-0 flex-wrap justify-center gap-1.5 border-0 p-0">
            <legend className="sr-only">{t("welcome.prompts.label")}</legend>
            {PROMPT_KEYS.map((key) => (
              <Button
                key={key}
                type="button"
                variant="outline"
                size="sm"
                className="rounded-chip"
                onClick={() => fillComposer(t(`welcome.prompts.${key}.text`))}>
                {t(`welcome.prompts.${key}.label`)}
              </Button>
            ))}
          </fieldset>
          <p className="text-center text-xs text-muted-foreground">
            {t("welcome.prompts.hint")}
          </p>
        </div>
      )}
    </div>
  )
}
