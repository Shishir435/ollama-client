import { useSelectionOverlay } from "../selection-overlay-context"
import { SelectionPanel } from "./selection-panel"
import { SelectionToolbar } from "./selection-toolbar"

/** Picks the collapsed toolbar or the expanded panel. */
export const SelectionActionsOverlay = () => {
  const { mode } = useSelectionOverlay()
  return mode === "toolbar" ? <SelectionToolbar /> : <SelectionPanel />
}
