import type {
  SelectionActionId,
  SelectionOverlayMode,
  SelectionPanelState
} from "./types"

export interface SelectionOverlayState {
  mode: SelectionOverlayMode
  panelState: SelectionPanelState
  currentAction: SelectionActionId
  resultText: string
  errorText: string
  isThinking: boolean
  thinkingText: string
  isMoreMenuOpen: boolean
  isPinned: boolean
  customInstruction: string
}

export type SelectionOverlayEvent =
  | { type: "selection.show"; enabledActionIds: SelectionActionId[] }
  | { type: "action.open"; actionId: SelectionActionId }
  | { type: "stream.start" }
  | {
      type: "stream.chunk"
      visibleDelta: string
      thinkingDelta: string
      isThinking: boolean
    }
  | { type: "stream.done" }
  | { type: "stream.error"; message: string }
  | { type: "panel.cancel" }
  | { type: "toolbar.back" }
  | { type: "overlay.hide" }
  | { type: "menu.toggle" }
  | { type: "pin.toggle" }
  | { type: "pin.enable" }
  | { type: "custom.set"; value: string }

const emptyRunState = {
  resultText: "",
  errorText: "",
  isThinking: false,
  thinkingText: ""
}

export const createSelectionOverlayState = (
  currentAction: SelectionActionId = "summarize"
): SelectionOverlayState => ({
  mode: "toolbar",
  panelState: "idle",
  currentAction,
  ...emptyRunState,
  isMoreMenuOpen: false,
  isPinned: false,
  customInstruction: ""
})

const firstEnabledAction = (enabledActionIds: SelectionActionId[]) =>
  enabledActionIds[0] ?? "summarize"

const normalizeCurrentAction = (
  currentAction: SelectionActionId,
  enabledActionIds: SelectionActionId[]
) =>
  enabledActionIds.includes(currentAction)
    ? currentAction
    : firstEnabledAction(enabledActionIds)

export function reduceSelectionOverlayState(
  state: SelectionOverlayState,
  event: SelectionOverlayEvent
): SelectionOverlayState {
  switch (event.type) {
    case "selection.show":
      return {
        ...createSelectionOverlayState(
          normalizeCurrentAction(state.currentAction, event.enabledActionIds)
        )
      }
    case "action.open":
      return {
        ...state,
        mode: "panel",
        panelState: "open",
        currentAction: event.actionId,
        ...emptyRunState,
        isMoreMenuOpen: false
      }
    case "stream.start":
      return {
        ...state,
        mode: "panel",
        panelState: "streaming",
        ...emptyRunState
      }
    case "stream.chunk":
      return {
        ...state,
        resultText: state.resultText + event.visibleDelta,
        thinkingText: state.thinkingText + event.thinkingDelta,
        isThinking: event.isThinking
      }
    case "stream.done":
      return {
        ...state,
        panelState: "done",
        isThinking: false
      }
    case "stream.error":
      return {
        ...state,
        panelState: "error",
        errorText: event.message,
        isThinking: false
      }
    case "panel.cancel":
      return {
        ...state,
        panelState: "open",
        ...emptyRunState
      }
    case "toolbar.back":
      return {
        ...createSelectionOverlayState(state.currentAction)
      }
    case "overlay.hide":
      return {
        ...createSelectionOverlayState(state.currentAction)
      }
    case "menu.toggle":
      return {
        ...state,
        isMoreMenuOpen: !state.isMoreMenuOpen
      }
    case "pin.toggle":
      return {
        ...state,
        isPinned: !state.isPinned
      }
    case "pin.enable":
      return {
        ...state,
        isPinned: true
      }
    case "custom.set":
      return {
        ...state,
        customInstruction: event.value
      }
  }
}
