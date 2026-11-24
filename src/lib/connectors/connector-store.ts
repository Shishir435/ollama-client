import { STORAGE_KEYS } from "@/lib/constants"
import {
  getPlasmoStoredValue,
  setPlasmoStoredValue
} from "@/lib/plasmo-global-storage"
import { parseStoredConnectors, type StoredConnector } from "./types"

/**
 * The only reader and writer of the connector list. Pages never read this key:
 * it holds credentials, so they go through the connector RPCs instead.
 */
export const readConnectors = async (): Promise<StoredConnector[]> =>
  parseStoredConnectors(
    await getPlasmoStoredValue<unknown>(STORAGE_KEYS.CONNECTORS.LIST)
  )

/**
 * Serialize read-modify-write mutations. A refresh can land while the user
 * flips a tool toggle; chaining each mutation onto the previous one keeps the
 * later write from clobbering the earlier change.
 */
let writeLock: Promise<unknown> = Promise.resolve()

export const mutateConnectors = <T>(
  apply: (current: StoredConnector[]) => {
    next: StoredConnector[]
    result: T
  }
): Promise<T> => {
  const run = writeLock.then(async () => {
    const current = await readConnectors()
    const { next, result } = apply(current)
    await setPlasmoStoredValue(STORAGE_KEYS.CONNECTORS.LIST, next)
    return result
  })
  writeLock = run.then(
    () => undefined,
    () => undefined
  )
  return run
}
