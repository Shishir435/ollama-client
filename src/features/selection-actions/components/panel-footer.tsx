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
  return (
    <div className="sa-panel-actions">
      <div className="sa-action-group">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className={buttonVariants({ variant: "outline", size: "icon" })}
                aria-label="Copy result"
                disabled={!resultText.trim()}
                onClick={onCopy}
              />
            }>
            <Copy aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent container={tooltipContainer}>
            Copy result
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className={buttonVariants({ variant: "outline", size: "icon" })}
                aria-label="Retry action"
                disabled={panelState === "streaming"}
                onClick={onRetry}
              />
            }>
            <RefreshCw aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent container={tooltipContainer}>
            Retry action
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
                  className={buttonVariants({
                    variant: "outline",
                    size: "default"
                  })}
                  onClick={onInsertBelow}
                />
              }>
              Insert Below
            </TooltipTrigger>
            <TooltipContent container={tooltipContainer}>
              Insert result below selection
            </TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className={buttonVariants({
                  variant: "outline",
                  size: "default"
                })}
                disabled={!resultText.trim()}
                onClick={onOpenChat}
              />
            }>
            <MessageSquare aria-hidden="true" />
            Open in Chat
          </TooltipTrigger>
          <TooltipContent container={tooltipContainer}>
            Open result in chat
          </TooltipContent>
        </Tooltip>

        {canReplace && (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className={buttonVariants({
                    variant: "default",
                    size: "default"
                  })}
                  onClick={onReplace}
                />
              }>
              <SquarePen aria-hidden="true" />
              Replace
            </TooltipTrigger>
            <TooltipContent container={tooltipContainer}>
              Replace selected text
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
              Cancel
            </TooltipTrigger>
            <TooltipContent container={tooltipContainer}>
              Cancel generation
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  )
}
