import { Upload } from "lucide-react"
import { useTranslation } from "react-i18next"

export interface ChatInputDragOverlayProps {
  isDragging: boolean
}

export const ChatInputDragOverlay = ({
  isDragging
}: ChatInputDragOverlayProps) => {
  const { t } = useTranslation()

  if (!isDragging) return null

  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center rounded-panel bg-background/90">
      <Upload className="mb-2 icon-3xl animate-bounce text-primary" />
      <p className="text-sm font-medium text-primary">
        {t("chat.input.drop_files_here")}
      </p>
    </div>
  )
}
