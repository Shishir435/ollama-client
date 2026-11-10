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
  /** Translation key for a failure the overlay words itself; wins over `errorText`. */
  errorKey: string
  isThinking: boolean
  thinkingText: string
  isPinned: boolean
  customInstruction: string
  refinement: { previousResult: string; instruction: string } | null
}

export type SelectionOverlayEvent =
  | { type: "action.open"; actionId: SelectionActionId }
  | { type: "stream.start" }
  | {
      type: "stream.chunk"
      visibleDelta: string
      thinkingDelta: string
      isThinking: boolean
    }
  | { type: "stream.done" }
  | { type: "stream.error"; message: string; messageKey?: string }
  | { type: "panel.cancel" }
  | { type: "toolbar.back" }
  | { type: "pin.toggle" }
  | { type: "pin.enable" }
  | { type: "custom.set"; value: string }
  | { type: "refinement.start"; instruction: string }

const emptyRunState = {
  resultText: "",
  errorText: "",
  errorKey: "",
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
  isPinned: false,
  customInstruction: "",
  refinement: null
})

export function reduceSelectionOverlayState(
  state: SelectionOverlayState,
  event: SelectionOverlayEvent
): SelectionOverlayState {
  switch (event.type) {
    case "action.open":
      return {
        ...state,
        mode: "panel",
        panelState: "open",
        currentAction: event.actionId,
        refinement: null,
        ...emptyRunState
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
        errorKey: event.messageKey ?? "",
        resultText: state.refinement?.previousResult ?? state.resultText,
        isThinking: false
      }
    case "panel.cancel":
      return {
        ...state,
        ...emptyRunState,
        panelState: state.refinement ? "done" : "open",
        resultText: state.refinement?.previousResult ?? ""
      }
    case "toolbar.back":
      return {
        ...createSelectionOverlayState(state.currentAction)
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
    case "refinement.start":
      if (
        state.panelState !== "done" ||
        !state.resultText.trim() ||
        !event.instruction.trim()
      )
        return state
      return {
        ...state,
        refinement: {
          previousResult: state.resultText,
          instruction: event.instruction.trim()
        }
      }
  }
}
