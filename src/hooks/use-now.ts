import { useEffect, useState } from "react"

/** Read the current time and refresh it on a coarse interval for live labels. */
export const useNow = (intervalMs = 60_000): number => {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(interval)
  }, [intervalMs])

  return now
}
