import type { PointerEvent as ReactPointerEvent } from "react"

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(value, max))

export function placeSelectionOverlay(
  container: HTMLElement,
  top: number,
  anchorLeft: number
) {
  container.style.display = "block"
  container.style.visibility = "hidden"

  const viewportMargin = 8
  const width = container.offsetWidth
  const height = container.offsetHeight
  const maxLeft = window.innerWidth - width - viewportMargin
  const maxTop = window.innerHeight - height - viewportMargin
  const targetLeft = clamp(anchorLeft - width / 2, viewportMargin, maxLeft)
  const targetTop = clamp(top, viewportMargin, maxTop)

  container.style.left = `${targetLeft}px`
  container.style.top = `${targetTop}px`

  const actual = container.getBoundingClientRect()
  const driftX = actual.left - targetLeft
  const driftY = actual.top - targetTop
  if (Math.abs(driftX) > 0.5 || Math.abs(driftY) > 0.5) {
    container.style.left = `${targetLeft - driftX}px`
    container.style.top = `${targetTop - driftY}px`
  }

  container.style.visibility = "visible"
}

interface OverlayDragOptions {
  container: HTMLElement
  markInteraction: () => void
  onDragStart: () => void
  onDragEnd: () => void
}

export function startOverlayDrag(
  event: ReactPointerEvent<HTMLElement>,
  { container, markInteraction, onDragStart, onDragEnd }: OverlayDragOptions
) {
  event.preventDefault()
  event.stopPropagation()
  markInteraction()
  onDragStart()

  const rect = container.getBoundingClientRect()
  const offsetX = event.clientX - rect.left
  const offsetY = event.clientY - rect.top

  const handleMove = (e: PointerEvent) => {
    const margin = 8
    const w = container.offsetWidth
    const h = container.offsetHeight
    container.style.left = `${clamp(
      e.clientX - offsetX,
      margin,
      window.innerWidth - w - margin
    )}px`
    container.style.top = `${clamp(
      e.clientY - offsetY,
      margin,
      window.innerHeight - h - margin
    )}px`
  }
  const handleUp = () => {
    document.removeEventListener("pointermove", handleMove, true)
    document.removeEventListener("pointerup", handleUp, true)
    onDragEnd()
  }

  document.addEventListener("pointermove", handleMove, true)
  document.addEventListener("pointerup", handleUp, true)
  onDragEnd()
}
