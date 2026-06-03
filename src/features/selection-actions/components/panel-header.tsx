import type { PointerEvent as ReactPointerEvent } from "react"
import { useTranslation } from "react-i18next"
import { buttonVariants } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { ArrowLeft, GripHorizontal, Pin, X } from "@/lib/lucide-icon"
import type { ProviderModel } from "@/types"
import { SELECTION_ACTIONS } from "../actions"
import type { SelectionActionId } from "../types"

interface PanelHeaderProps {
  currentAction: SelectionActionId
  enabledActionIds: SelectionActionId[]
  panelModel: string
  availableModels: ProviderModel[]
  isPinned: boolean
  tooltipContainer: HTMLElement | ShadowRoot | null
  onActionChange: (actionId: SelectionActionId) => void
  onModelChange: (model: string, providerId?: string) => void
  onTogglePin: () => void
  onBack: () => void
  onClose: () => void
  onDragStart: (event: ReactPointerEvent<HTMLElement>) => void
}

export function PanelHeader({
  currentAction,
  enabledActionIds,
  panelModel,
  availableModels,
  isPinned,
  tooltipContainer,
  onActionChange,
  onModelChange,
  onTogglePin,
  onBack,
  onClose,
  onDragStart
}: PanelHeaderProps) {
  const { t } = useTranslation()
  const enabledActions = SELECTION_ACTIONS.filter((a) =>
    enabledActionIds.includes(a.id)
  )

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
            <button
              type="button"
              className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
              aria-label={t("selection_button.panel.back")}
              onClick={onBack}
            />
          }>
          <ArrowLeft aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent container={tooltipContainer}>
          {t("selection_button.panel.back")}
        </TooltipContent>
      </Tooltip>

      <div className="sa-title-row">
        <select
          className="sa-action-select"
          value={currentAction}
          onChange={(e) => onActionChange(e.target.value as SelectionActionId)}>
          {enabledActions.map((a) => (
            <option key={a.id} value={a.id}>
              {t(`selection_button.actions.${a.id}.label`, a.label)}
            </option>
          ))}
        </select>
        {modelNode}
      </div>

      <div className="sa-header-actions">
        <Tooltip>
          <TooltipTrigger
            render={
              <div className="sa-drag-handle" onPointerDown={onDragStart} />
            }>
            <GripHorizontal aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent container={tooltipContainer}>
            {t("selection_button.panel.drag_panel")}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className={buttonVariants({
                  variant: isPinned ? "secondary" : "ghost",
                  size: "icon-sm"
                })}
                aria-label={
                  isPinned
                    ? t("selection_button.panel.unpin")
                    : t("selection_button.panel.pin")
                }
                onClick={onTogglePin}
              />
            }>
            <Pin aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent container={tooltipContainer}>
            {isPinned
              ? t("selection_button.panel.unpin")
              : t("selection_button.panel.pin")}
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
                aria-label={t("selection_button.panel.close")}
                onClick={onClose}
              />
            }>
            <X aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent container={tooltipContainer}>
            {t("selection_button.panel.close")}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
