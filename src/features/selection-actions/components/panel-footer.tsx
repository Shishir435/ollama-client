import { useTranslation } from "react-i18next"
import { buttonVariants } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { Copy, MessageSquare, RefreshCw, SquarePen } from "@/lib/lucide-icon"
import type { SelectionPanelState } from "./selection-actions-overlay"

interface PanelFooterProps {
  panelState: SelectionPanelState
  resultText: string
  canReplace: boolean
  canInsert: boolean
  tooltipContainer: HTMLElement | ShadowRoot | null
  onCopy: () => void
  onRetry: () => void
  onReplace: () => void
  onInsertBelow: () => void
  onOpenChat: () => void
  onCancel: () => void
}

export function PanelFooter({
  panelState,
  resultText,
  canReplace,
  canInsert,
  tooltipContainer,
  onCopy,
  onRetry,
  onReplace,
  onInsertBelow,
  onOpenChat,
  onCancel
}: PanelFooterProps) {
  const { t } = useTranslation()
  return (
    <div className="sa-panel-actions">
      <div className="sa-action-group">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className={buttonVariants({ variant: "outline", size: "icon" })}
                aria-label={t("selection_button.panel.copy")}
                disabled={!resultText.trim()}
                onClick={onCopy}
              />
            }>
            <Copy aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent container={tooltipContainer}>
            {t("selection_button.panel.copy")}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className={buttonVariants({ variant: "outline", size: "icon" })}
                aria-label={t("selection_button.panel.retry")}
                disabled={panelState === "streaming"}
                onClick={onRetry}
              />
            }>
            <RefreshCw aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent container={tooltipContainer}>
            {t("selection_button.panel.retry")}
          </TooltipContent>
        </Tooltip>
      </div>

      <div className="sa-action-group apply-group">
        {canInsert && (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={t("selection_button.panel.insert")}
                  className={buttonVariants({
                    variant: "outline",
                    size: "default"
                  })}
                  onClick={onInsertBelow}
                />
              }>
              {t("selection_button.panel.insert")}
            </TooltipTrigger>
            <TooltipContent container={tooltipContainer}>
              {t("selection_button.panel.insert_tip")}
            </TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={t("selection_button.panel.open_chat")}
                className={buttonVariants({
                  variant: "outline",
                  size: "default"
                })}
                disabled={!resultText.trim()}
                onClick={onOpenChat}
              />
            }>
            <MessageSquare aria-hidden="true" />
            {t("selection_button.panel.open_chat")}
          </TooltipTrigger>
          <TooltipContent container={tooltipContainer}>
            {t("selection_button.panel.open_chat_tip")}
          </TooltipContent>
        </Tooltip>

        {canReplace && (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={t("selection_button.panel.replace")}
                  className={buttonVariants({
                    variant: "default",
                    size: "default"
                  })}
                  onClick={onReplace}
                />
              }>
              <SquarePen aria-hidden="true" />
              {t("selection_button.panel.replace")}
            </TooltipTrigger>
            <TooltipContent container={tooltipContainer}>
              {t("selection_button.panel.replace_tip")}
            </TooltipContent>
          </Tooltip>
        )}

        {panelState === "streaming" && (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className={buttonVariants({
                    variant: "destructive",
                    size: "default"
                  })}
                  onClick={onCancel}
                />
              }>
              {t("selection_button.panel.cancel")}
            </TooltipTrigger>
            <TooltipContent container={tooltipContainer}>
              {t("selection_button.panel.cancel_tip")}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  )
}
