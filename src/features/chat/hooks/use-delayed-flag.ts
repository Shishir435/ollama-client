import { useEffect, useState } from "react"

/**
 * True once `active` has held for `delayMs` without a break, and false again
 * the moment it stops. For a hint that is only worth showing when something is
 * taking longer than it should.
 */
export const useDelayedFlag = (active: boolean, delayMs: number): boolean => {
  const [elapsed, setElapsed] = useState(false)

  useEffect(() => {
    if (!active) return
    const timer = setTimeout(() => setElapsed(true), delayMs)
    return () => {
      clearTimeout(timer)
      setElapsed(false)
    }
  }, [active, delayMs])

  return active && elapsed
}
