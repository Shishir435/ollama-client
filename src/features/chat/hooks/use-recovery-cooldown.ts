import { useEffect, useState } from "react"

/**
 * Countdown until a cooled-down recovery action becomes usable. Anchored to the
 * message timestamp, not to mount, so remounting the bubble (the message list is
 * virtualized) cannot restart a provider's back-off window.
 */
export const useRecoveryCooldown = (
  cooldownMs: number | undefined,
  timestamp: number | undefined
): number => {
  // Preserve the timer-owned countdown boundary rather than adding compiler caches.
  "use no memo"

  // Only reached for a message with no timestamp; persisted messages always
  // carry one, which is what keeps the window stable across remounts.
  const [mountedAt] = useState(() => Date.now())
  const deadline = (timestamp ?? mountedAt) + (cooldownMs ?? 0)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!cooldownMs || deadline <= now) return
    const interval = setInterval(() => {
      setNow(Date.now())
    }, 500)
    return () => clearInterval(interval)
  }, [cooldownMs, deadline, now])

  return cooldownMs ? Math.max(0, deadline - now) : 0
}
