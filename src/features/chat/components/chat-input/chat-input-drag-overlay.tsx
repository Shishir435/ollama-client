import { Upload } from "lucide-react"
import { useTranslation } from "react-i18next"

interface ChatInputDragOverlayProps {
  isDragging: boolean
}

export const ChatInputDragOverlay = ({
  isDragging
}: ChatInputDragOverlayProps) => {
  const { t } = useTranslation()

  if (!isDragging) return null

  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center rounded-xl bg-background/80 backdrop-blur-sm">
      <Upload className="mb-2 size-8 animate-bounce text-primary" />
      <p className="text-sm font-medium text-primary">
        {t("chat.input.drop_files_here")}
      </p>
    </div>
  )
}
