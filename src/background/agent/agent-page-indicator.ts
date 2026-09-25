/**
 * What the page shows while a run drives it: a thin outline around the
 * viewport, and the control about to be pressed outlined as it is pressed.
 *
 * Drawn by the debugger's own overlay rather than as page DOM, which is what
 * keeps it out of every other rule. An element injected into the page is one
 * the observation would read, a hit test could land on and a form could
 * contain; the overlay is none of those — `elementFromPoint` answers as if it
 * were not there, and nothing the run observes can see it. What it is not
 * kept out of is `Page.captureScreenshot`, measured on a real Chromium, so
 * every capture hides it first and restores it after: a model shown the
 * outline would take it for part of the page.
 *
 * Every call is best effort. An overlay that cannot be drawn costs the user
 * a cue, never the run a step.
 */

type Send = (method: string, params?: object) => Promise<unknown>

const OUTLINE = { r: 124, g: 58, b: 237, a: 0.9 }
const CLEAR = { r: 0, g: 0, b: 0, a: 0 }
const TARGET_FILL = { r: 124, g: 58, b: 237, a: 0.12 }

interface LayoutMetrics {
  cssLayoutViewport: { clientWidth: number; clientHeight: number }
}

const isLayoutMetrics = (value: unknown): value is LayoutMetrics => {
  const viewport = (value as { cssLayoutViewport?: unknown } | undefined)
    ?.cssLayoutViewport as
    | { clientWidth?: unknown; clientHeight?: unknown }
    | undefined
  return (
    typeof viewport?.clientWidth === "number" &&
    typeof viewport.clientHeight === "number"
  )
}

export interface AgentPageIndicator {
  /** The viewport outline: shown on attach, after navigation and captures. */
  show(): Promise<void>
  /**
   * Nothing drawn, and nothing redrawn, until `resume`: a delayed outline
   * landing between the hide and the capture would put it in the picture.
   */
  suspend(): Promise<void>
  resume(): Promise<void>
  /** The control under this root-viewport point, while it is pressed. */
  target(point: { x: number; y: number }): Promise<void>
}

/**
 * `enableDom` is the attachment's own, shared with the box-model reads that
 * need the same domain, so the root session is enabled once whoever asks.
 */
export const createAgentPageIndicator = (
  send: Send,
  enableDom: () => Promise<void>
): AgentPageIndicator => {
  let enabled: Promise<boolean> | undefined
  let suspended = 0
  const enable = () => {
    enabled ??= enableDom()
      .then(() => send("Overlay.enable"))
      .then(
        () => true,
        () => false
      )
    return enabled
  }
  return {
    async show() {
      if (suspended > 0 || !(await enable())) return
      try {
        const metrics = await send("Page.getLayoutMetrics")
        if (!isLayoutMetrics(metrics)) return
        await send("Overlay.highlightRect", {
          x: 0,
          y: 0,
          width: Math.round(metrics.cssLayoutViewport.clientWidth),
          height: Math.round(metrics.cssLayoutViewport.clientHeight),
          color: CLEAR,
          outlineColor: OUTLINE
        })
      } catch {
        // A cue, not a requirement.
      }
    },
    async suspend() {
      suspended += 1
      if (!(await enable())) return
      await send("Overlay.hideHighlight").catch(() => undefined)
    },
    async resume() {
      suspended = Math.max(0, suspended - 1)
      await this.show()
    },
    async target(point) {
      if (suspended > 0 || !(await enable())) return
      try {
        const node = (await send("DOM.getNodeForLocation", {
          x: Math.round(point.x),
          y: Math.round(point.y),
          includeUserAgentShadowDOM: false
        })) as { backendNodeId?: unknown } | undefined
        if (typeof node?.backendNodeId !== "number") return
        await send("Overlay.highlightNode", {
          backendNodeId: node.backendNodeId,
          highlightConfig: {
            contentColor: TARGET_FILL,
            borderColor: OUTLINE,
            showInfo: false
          }
        })
      } catch {
        // A cue, not a requirement.
      }
    }
  }
}
