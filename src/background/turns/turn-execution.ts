/**
 * Startup recovery can read a row a live submission just created. SQL permits
 * generating → generating for restart recovery, so it cannot distinguish two
 * producers in the same worker. Claim before the first await and hold through
 * cleanup; a replacement worker starts empty and may recover the durable row.
 */
const activeTurns = new Set<string>()

export const claimTurnExecution = (
  turnId: string
): (() => void) | undefined => {
  if (activeTurns.has(turnId)) return undefined
  activeTurns.add(turnId)
  let released = false
  return () => {
    if (released) return
    released = true
    activeTurns.delete(turnId)
  }
}
