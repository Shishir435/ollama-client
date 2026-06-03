import type { PointerEvent as ReactPointerEvent } from "react"
import { buttonVariants } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { GripHorizontal, Pin, X } from "@/lib/lucide-icon"
import type { ProviderModel } from "@/types"

interface PanelHeaderProps {
  actionLabel: string
  panelModel: string
  availableModels: ProviderModel[]
  isPinned: boolean
  tooltipContainer: HTMLElement | ShadowRoot | null
  onModelChange: (model: string, providerId?: string) => void
  onTogglePin: () => void
  onClose: () => void
  onDragStart: (event: ReactPointerEvent<HTMLElement>) => void
}

export function PanelHeader({
  actionLabel,
  panelModel,
  availableModels,
  isPinned,
  tooltipContainer,
  onModelChange,
  onTogglePin,
  onClose,
  onDragStart
}: PanelHeaderProps) {
  const modelNode =
    availableModels.length > 0 ? (
      <select
        className="sa-model-inline"
        value={panelModel}
        onChange={(e) => {
          const m = availableModels.find((x) => x.model === e.target.value)
          onModelChange(e.target.value, m?.providerId)
        }}>
        {panelModel && !availableModels.find((m) => m.model === panelModel) && (
          <option value={panelModel}>{panelModel}</option>
        )}
        {availableModels.map((m) => (
          <option key={m.model} value={m.model}>
            {m.name || m.model}
          </option>
        ))}
      </select>
    ) : panelModel ? (
      <span className="sa-model-name sa-muted">{panelModel}</span>
    ) : null

  return (
    <div className="sa-panel-header">
      <Tooltip>
        <TooltipTrigger
          render={
            <div className="sa-drag-handle" onPointerDown={onDragStart} />
          }>
          <GripHorizontal aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent container={tooltipContainer}>Drag panel</TooltipContent>
      </Tooltip>

      <div className="sa-title-row">
        <span className="sa-title">{actionLabel}</span>
        {modelNode}
      </div>

      <div className="sa-header-actions">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className={buttonVariants({
                  variant: isPinned ? "secondary" : "ghost",
                  size: "icon-sm"
                })}
                aria-label={isPinned ? "Unpin panel" : "Pin panel"}
                onClick={onTogglePin}
              />
            }>
            <Pin aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent container={tooltipContainer}>
            {isPinned ? "Unpin panel" : "Pin panel"}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className={buttonVariants({
                  variant: "ghost",
                  size: "icon-sm"
                })}
                aria-label="Close"
                onClick={onClose}
              />
            }>
            <X aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent container={tooltipContainer}>Close</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
