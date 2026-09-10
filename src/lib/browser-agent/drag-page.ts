/**
 * A drag without a debugger: the synthetic event sequence the DOM backend
 * sends when no native pointer is available.
 *
 * Two families of drag-and-drop exist and a page may use either. Pointer-based
 * libraries read `pointerdown`/`pointermove`/`pointerup` (and their mouse
 * twins) and move the element themselves; HTML5 drag-and-drop starts with a
 * `dragstart` the browser fires on a `draggable` element and ends with a
 * `drop` on whichever element cancelled `dragover`. Both sequences are sent,
 * in the order a real gesture would produce them, and the same `DataTransfer`
 * travels from `dragstart` to `drop` so what the source wrote the target can
 * read. A page can tell these events from a user's; the receipt says so.
 */

export interface AgentSyntheticDragInput {
  source: Element
  destination: Element
  /** Where the gesture starts, in this frame's viewport CSS pixels. */
  from: { x: number; y: number }
  /** Where it ends. */
  to: { x: number; y: number }
}

type PointerCtor = new (type: string, init: MouseEventInit) => MouseEvent

const pointerInit = (
  view: Window | null | undefined,
  point: { x: number; y: number },
  buttons: number
): MouseEventInit => ({
  bubbles: true,
  cancelable: true,
  composed: true,
  clientX: point.x,
  clientY: point.y,
  button: 0,
  buttons,
  view: view ?? undefined
})

const dispatchPointer = (
  target: Element,
  types: readonly string[],
  init: MouseEventInit
): void => {
  const view = target.ownerDocument.defaultView
  const Pointer = (view?.PointerEvent ?? globalThis.PointerEvent) as
    | PointerCtor
    | undefined
  for (const type of types) {
    const usesPointer = type.startsWith("pointer")
    const Ctor = usesPointer && Pointer ? Pointer : MouseEvent
    target.dispatchEvent(
      new Ctor(type, {
        ...init,
        ...(usesPointer ? { pointerId: 1, isPrimary: true } : {})
      } as MouseEventInit)
    )
  }
}

/**
 * The store a `dragstart` handler writes and a `drop` handler reads. The
 * platform's own `DataTransfer` is used where it can be constructed; the
 * shim carries the same read/write surface for a runtime without one.
 */
const createDataTransfer = (view: Window | null | undefined): DataTransfer => {
  const Ctor =
    (view as (Window & typeof globalThis) | null | undefined)?.DataTransfer ??
    globalThis.DataTransfer
  if (typeof Ctor === "function") {
    try {
      return new Ctor()
    } catch {
      /* A runtime that declares the constructor but refuses it gets the shim. */
    }
  }
  const data = new Map<string, string>()
  const shim = {
    dropEffect: "none",
    effectAllowed: "all",
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    get types() {
      return [...data.keys()]
    },
    setData(format: string, value: string) {
      data.set(format.toLowerCase(), value)
    },
    getData(format: string) {
      return data.get(format.toLowerCase()) ?? ""
    },
    clearData(format?: string) {
      if (format === undefined) data.clear()
      else data.delete(format.toLowerCase())
    },
    setDragImage() {
      /* Nothing is painted for a synthetic drag. */
    }
  }
  return shim as unknown as DataTransfer
}

const dragEvent = (
  view: Window | null | undefined,
  type: string,
  init: MouseEventInit,
  dataTransfer: DataTransfer
): Event => {
  const Ctor = ((view as (Window & typeof globalThis) | null | undefined)
    ?.DragEvent ?? globalThis.DragEvent) as
    | (new (
        type: string,
        init: DragEventInit
      ) => DragEvent)
    | undefined
  const event =
    typeof Ctor === "function"
      ? new Ctor(type, { ...init, dataTransfer })
      : new MouseEvent(type, init)
  /**
   * The constructor's own `dataTransfer` is defined only where the runtime
   * implements it; the store is forced on regardless, so the one object
   * travels from `dragstart` to `drop` even where the DragEvent init drops it.
   */
  if ((event as DragEvent).dataTransfer !== dataTransfer) {
    Object.defineProperty(event, "dataTransfer", {
      configurable: true,
      value: dataTransfer
    })
  }
  return event
}

const isDraggable = (element: Element): boolean => {
  const declared = element.getAttribute("draggable")
  if (declared !== null) return declared.toLowerCase() === "true"
  return (element as Partial<HTMLElement>).draggable === true
}

export interface AgentSyntheticDragOutcome {
  /** Whether the page accepted an HTML5 drop on the destination. */
  dropped: boolean
}

/**
 * Sends the gesture. The pointer sequence always goes out — it is what a
 * pointer-based library reads and does no harm to an HTML5 page. The HTML5
 * sequence goes out only for a draggable source whose `dragstart` was not
 * cancelled, and `drop` only when the destination cancelled `dragover`, which
 * is the page's way of saying it accepts the drop. `dragend` closes either
 * way, so the source never stays in a dragging state.
 */
export const executeAgentSyntheticDrag = (
  input: AgentSyntheticDragInput
): AgentSyntheticDragOutcome => {
  const { source, destination, from, to } = input
  const view = source.ownerDocument.defaultView
  const midpoint = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }

  dispatchPointer(
    source,
    ["pointerdown", "mousedown"],
    pointerInit(view, from, 1)
  )
  dispatchPointer(
    source,
    ["pointermove", "mousemove"],
    pointerInit(view, midpoint, 1)
  )

  let dropped = false
  if (isDraggable(source)) {
    const dataTransfer = createDataTransfer(view)
    const started = source.dispatchEvent(
      dragEvent(view, "dragstart", pointerInit(view, from, 1), dataTransfer)
    )
    if (started) {
      destination.dispatchEvent(
        dragEvent(view, "dragenter", pointerInit(view, to, 1), dataTransfer)
      )
      const accepts = !destination.dispatchEvent(
        dragEvent(view, "dragover", pointerInit(view, to, 1), dataTransfer)
      )
      if (accepts) {
        destination.dispatchEvent(
          dragEvent(view, "drop", pointerInit(view, to, 1), dataTransfer)
        )
        dropped = true
      } else {
        destination.dispatchEvent(
          dragEvent(view, "dragleave", pointerInit(view, to, 1), dataTransfer)
        )
      }
      source.dispatchEvent(
        dragEvent(view, "dragend", pointerInit(view, to, 0), dataTransfer)
      )
    }
  }

  dispatchPointer(
    destination,
    ["pointermove", "mousemove"],
    pointerInit(view, to, 1)
  )
  dispatchPointer(
    destination,
    ["pointerup", "mouseup"],
    pointerInit(view, to, 0)
  )
  return { dropped }
}
