/**
 * Whether the user asked the system to minimise motion. Reads the media query
 * at call time, so a preference changed while the page is open is honoured on
 * the next scroll. Environments without `matchMedia` report no preference.
 */
export const prefersReducedMotion = (): boolean => {
  try {
    return (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
  } catch {
    return false
  }
}

/** The scroll behaviour to request: `"auto"` under reduced motion, otherwise `"smooth"`. */
export const motionSafeScrollBehavior = (): "auto" | "smooth" =>
  prefersReducedMotion() ? "auto" : "smooth"
