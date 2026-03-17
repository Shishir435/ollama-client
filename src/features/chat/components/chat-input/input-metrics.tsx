import { useTranslation } from "react-i18next"
import { CharCount } from "@/features/chat/components/char-count"

interface InputMetricsProps {
  inputLength: number
}

export const InputMetrics = ({ inputLength }: InputMetricsProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex items-center gap-3">
      <CharCount count={inputLength} />
      <div className="hidden text-xs text-muted-foreground sm:block">
        <kbd className="rounded bg-muted px-1.5 py-0.5 text-xs">
          {t("chat.input.enter_key")}
        </kbd>{" "}
        {t("chat.input.enter_to_send")}
      </div>
    </div>
  )
}
