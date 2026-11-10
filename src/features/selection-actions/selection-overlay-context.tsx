import type { ReactNode, PointerEvent as ReactPointerEvent } from "react"
import { createContext, useContext } from "react"
import type { ProviderModel } from "@/types"
import type {
  SelectionActionId,
  SelectionOverlayMode,
  SelectionPanelState
} from "./types"

export type SelectionOverlayNotice =
  | "copied"
  | "copy_failed"
  | "apply_failed"
  | "apply_stale"
  | "applied"
  | "undone"
  | "undo_failed"
  | "open_chat_failed"

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
  resultText: string
  originalText?: string
  errorText: string
  /** Translation key for the failure; rendered instead of `errorText` when set. */
  errorKey: string
  /** Outcome of the last copy / replace / insert, shown beside the result. */
  canUndo: boolean
  canRestoreResult?: boolean
  isOpeningChat?: boolean
  notice: SelectionOverlayNotice | null
  isThinking: boolean
  thinkingText: string
  availableModels: ProviderModel[]
  panelModel: string
  panelProviderId?: string
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
  refine: (instruction: string) => void
  startDrag: (event: ReactPointerEvent<HTMLElement>) => void
  /** Move the overlay by a keyboard step; pins it so it stays put. */
  nudge: (dx: number, dy: number) => void
  /** Put back what the last Replace / Insert wrote, while the page is unchanged. */
  undo: () => void
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
