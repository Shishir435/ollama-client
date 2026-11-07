import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState
} from "react"
import { logger } from "@/lib/logger"
import { getPlasmoStorageForKey } from "@/lib/plasmo-global-storage"
import { readSetting, writeSetting } from "@/lib/storage/setting-access"
import type { RequiredSettingDescriptor } from "@/lib/storage/setting-descriptor"

export const useSetting = <T>(
  descriptor: RequiredSettingDescriptor<T>
): [T, Dispatch<SetStateAction<T>>, { isLoading: boolean }] => {
  const [value, setValue] = useState<T>(descriptor.defaultValue)
  const valueRef = useRef(value)
  /**
   * Writes this hook has sent that storage has not yet settled. A change
   * event fired while one is in flight is this hook's own echo, and the read
   * it triggers can resolve to an earlier write than the value already shown —
   * which jumped a dragged slider back a stop at a time. The optimistic value
   * is the newer one, so such reads are dropped.
   */
  const pendingWritesRef = useRef(0)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let active = true
    const storage = getPlasmoStorageForKey(descriptor.key)
    const callback = () => {
      void readSetting(descriptor)
        .then((next) => {
          if (active && pendingWritesRef.current === 0) {
            const resolved = next ?? descriptor.defaultValue
            valueRef.current = resolved
            setValue(resolved)
          }
        })
        .finally(() => {
          if (active) setIsLoading(false)
        })
    }
    const watch = { [descriptor.key]: callback }

    callback()
    storage.watch(watch)
    return () => {
      active = false
      storage.unwatch(watch)
    }
  }, [descriptor])

  const setAndPersist = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => {
      const resolved =
        typeof next === "function"
          ? (next as (value: T) => T)(valueRef.current)
          : next
      valueRef.current = resolved
      setValue(resolved)
      pendingWritesRef.current += 1
      void writeSetting(descriptor, resolved)
        .finally(() => {
          pendingWritesRef.current -= 1
        })
        .catch((error) => {
          logger.error("Setting write failed", "useSetting", {
            key: descriptor.key,
            error
          })
          void readSetting(descriptor).then((stored) => {
            const rollback = stored ?? descriptor.defaultValue
            valueRef.current = rollback
            setValue(rollback)
          })
        })
    },
    [descriptor]
  )

  return [value, setAndPersist, { isLoading }]
}
