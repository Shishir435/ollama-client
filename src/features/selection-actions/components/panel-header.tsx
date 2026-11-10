import { ArrowLeft, GripHorizontal, Pin, X } from "lucide-react"
import { useTranslation } from "react-i18next"
import {
  type ActionConfig,
  ActionGroup,
  TooltipActionButton
} from "@/components/actions"
import { SELECTION_ACTIONS } from "../actions"
import { useSelectionOverlay } from "../selection-overlay-context"
import type { SelectionActionId } from "../types"
import { DragHandle } from "./drag-handle"

/**
 * Match provider IDs exactly. A legacy name may route through a saved mapping
 * absent from the catalog, so retain its bare option until the user chooses.
 */
export function PanelHeader() {
  const { t } = useTranslation()
  const {
    currentAction,
    enabledActionIds,
    panelModel,
    panelProviderId,
    availableModels,
    isPinned,
    tooltipContainer,
    actions
  } = useSelectionOverlay()

  const enabledActions = SELECTION_ACTIONS.filter((a) =>
    enabledActionIds.includes(a.id)
  )
  const backAction: ActionConfig[] = [
    {
      key: "back",
      variant: "ghost",
      size: "icon-sm",
      label: t("selection_button.panel.back"),
      onClick: actions.back,
      icon: ArrowLeft
    }
  ]
  const headerActions: ActionConfig[] = [
    {
      key: "pin",
      variant: isPinned ? "secondary" : "ghost",
      size: "icon-sm",
      label: isPinned
        ? t("selection_button.panel.unpin")
        : t("selection_button.panel.pin"),
      onClick: actions.togglePin,
      icon: Pin
    },
    {
      key: "close",
      variant: "ghost",
      size: "icon-sm",
      label: t("selection_button.panel.close"),
      onClick: actions.close,
      icon: X
    }
  ]

  const modelKey = (model: string, providerId?: string) =>
    JSON.stringify([providerId ?? "", model])
  const selectedEntry = availableModels.find(
    (model) =>
      model.model === panelModel && model.providerId === panelProviderId
  )
  const selectedModelKey = modelKey(panelModel, panelProviderId)
  const modelNode =
    availableModels.length > 0 ? (
      <select
        className="sa-model-inline"
        aria-label={t("selection_button.panel.model_label")}
        value={panelModel ? selectedModelKey : ""}
        onChange={(e) => {
          const model = availableModels.find(
            (candidate) =>
              modelKey(candidate.model, candidate.providerId) === e.target.value
          )
          if (model) actions.changeModel(model.model, model.providerId)
        }}>
        {/* An empty value would otherwise display the first model while the request carries none. */}
        {!panelModel && (
          <option value="" disabled>
            {t("selection_button.panel.model_placeholder")}
          </option>
        )}
        {panelModel && !selectedEntry && (
          <option value={selectedModelKey}>{panelModel}</option>
        )}
        {availableModels.map((m) => (
          <option
            key={modelKey(m.model, m.providerId)}
            value={modelKey(m.model, m.providerId)}>
            {m.name || m.model}
            {m.providerName || m.providerId
              ? ` · ${m.providerName || m.providerId}`
              : ""}
          </option>
        ))}
      </select>
    ) : panelModel ? (
      <span className="sa-model-name sa-muted">{panelModel}</span>
    ) : null

  return (
    <div className="sa-panel-header">
      <ActionGroup
        actions={backAction}
        tooltipContainer={tooltipContainer}
        wrap={false}
      />

      <div className="sa-title-row">
        <select
          className="sa-action-select"
          aria-label={t("selection_button.panel.action_label")}
          value={currentAction}
          onChange={(e) =>
            actions.runAction(e.target.value as SelectionActionId)
          }>
          {enabledActions.map((a) => (
            <option key={a.id} value={a.id}>
              {t(`selection_button.actions.${a.id}.label`)}
            </option>
          ))}
        </select>
        {modelNode}
      </div>

      <div className="sa-header-actions">
        <TooltipActionButton
          trigger={
            <DragHandle
              className="sa-drag-handle"
              label={t("selection_button.panel.drag_panel")}
            />
          }
          icon={GripHorizontal}
          label={t("selection_button.panel.drag_panel")}
          tooltipContainer={tooltipContainer}
        />

        <ActionGroup
          actions={headerActions}
          tooltipContainer={tooltipContainer}
          wrap={false}
        />
      </div>
    </div>
  )
}
