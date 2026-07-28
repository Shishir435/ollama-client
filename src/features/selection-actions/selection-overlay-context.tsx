import type { ReactNode, PointerEvent as ReactPointerEvent } from "react"
import { createContext, useContext } from "react"

import type { ProviderModel } from "@/types"
import type {
  SelectionActionId,
  SelectionOverlayMode,
  SelectionPanelState
} from "./types"

/**
 * What the overlay is currently showing. Every field is derived in
 * `SelectionOverlayApp` from the reducer state, the capture, or the settings the
 * content script handed in.
 */
export interface SelectionOverlayView {
  mode: SelectionOverlayMode
  panelState: SelectionPanelState
  currentAction: SelectionActionId
  enabledActionIds: SelectionActionId[]
  isMoreMenuOpen: boolean
  resultText: string
  errorText: string
  isThinking: boolean
  thinkingText: string
  availableModels: ProviderModel[]
  panelModel: string
  canReplace: boolean
  canInsert: boolean
  isPinned: boolean
  customInstruction: string
  /**
   * Portal target for tooltips. The overlay renders inside a shadow root, so a
   * tooltip appended to `document.body` would lose the shadow stylesheet.
   */
  tooltipContainer: HTMLElement | ShadowRoot | null
}

export interface SelectionOverlayActions {
  /**
   * Open an action and stream it. Also serves the panel's action `<select>`:
   * switching action there re-runs, which is the same operation.
   */
  runAction: (actionId: SelectionActionId) => void
  changeModel: (model: string, providerId?: string) => void
  toggleMore: () => void
  togglePin: () => void
  copy: () => void
  replace: () => void
  insertBelow: () => void
  openChat: () => void
  retry: () => void
  cancel: () => void
  back: () => void
  close: () => void
  setCustomInstruction: (value: string) => void
  runCustom: () => void
  startDrag: (event: ReactPointerEvent<HTMLElement>) => void
}

export type SelectionOverlayContextValue = SelectionOverlayView & {
  actions: SelectionOverlayActions
}

const SelectionOverlayContext =
  createContext<SelectionOverlayContextValue | null>(null)

/**
 * The overlay tree reads its state from context rather than props.
 *
 * It is one component per level with a single root and no reuse elsewhere, so
 * every prop was threaded straight through: `SelectionActionsOverlay` took 32
 * and `SelectionPanel` 28, most of them forwarded unchanged to `PanelHeader` or
 * `PanelFooter`. Adding one control meant touching four files. Context is the
 * shape every other feature in this codebase already uses for this.
 */
export const SelectionOverlayProvider = ({
  value,
  children
}: {
  value: SelectionOverlayContextValue
  children: ReactNode
}) => (
  <SelectionOverlayContext.Provider value={value}>
    {children}
  </SelectionOverlayContext.Provider>
)

export const useSelectionOverlay = (): SelectionOverlayContextValue => {
  const value = useContext(SelectionOverlayContext)
  if (!value) {
    throw new Error(
      "useSelectionOverlay must be called inside a SelectionOverlayProvider"
    )
  }
  return value
}

/** Convenience for the many components that only dispatch. */
export const useSelectionOverlayActions = (): SelectionOverlayActions =>
  useSelectionOverlay().actions
