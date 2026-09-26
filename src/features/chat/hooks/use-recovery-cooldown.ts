import { useEffect, useRef, useState } from "react"

/**
 * Countdown until a cooled-down recovery action becomes usable. Anchored to the
 * message timestamp, not to mount, so remounting the bubble (the message list is
 * virtualized) cannot restart a provider's back-off window.
 */
export const useRecoveryCooldown = (
  cooldownMs: number | undefined,
  timestamp: number | undefined
): number => {
  // Only reached for a message with no timestamp; persisted messages always
  // carry one, which is what keeps the window stable across remounts.
  const mountedAt = useRef(Date.now())
  const deadline = (timestamp ?? mountedAt.current) + (cooldownMs ?? 0)
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, deadline - Date.now())
  )

  useEffect(() => {
    if (!cooldownMs) {
      setRemaining(0)
      return
    }
    const tick = () => {
      const next = Math.max(0, deadline - Date.now())
      setRemaining(next)
      return next
    }
    if (tick() === 0) return
    const interval = setInterval(() => {
      if (tick() === 0) clearInterval(interval)
    }, 500)
    return () => clearInterval(interval)
  }, [cooldownMs, deadline])

  return cooldownMs ? remaining : 0
}
