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
   * Writes this hook has sent that storage has not yet settled, and a counter
   * of writes ever started. A storage read is applied only when no write is in
   * flight and none started since the read began: a read racing a write can
   * resolve to an earlier value than the one already shown, which jumped a
   * dragged slider back a stop at a time.
   *
   * Dropping such a read could also drop another page's change, so storage is
   * read again whenever the last pending write settles. That same read is the
   * rollback for a failed write, and it cannot undo a newer value: a write
   * started after it either holds the counter above zero or bumps the
   * generation.
   */
  const pendingWritesRef = useRef(0)
  const writeGenerationRef = useRef(0)
  const refreshRef = useRef<() => void>(() => {})
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let active = true
    const storage = getPlasmoStorageForKey(descriptor.key)
    const refresh = () => {
      const generation = writeGenerationRef.current
      void readSetting(descriptor)
        .then((next) => {
          if (
            !active ||
            pendingWritesRef.current > 0 ||
            writeGenerationRef.current !== generation
          ) {
            return
          }
          const resolved = next ?? descriptor.defaultValue
          valueRef.current = resolved
          setValue(resolved)
        })
        .finally(() => {
          if (active) setIsLoading(false)
        })
    }
    const watch = { [descriptor.key]: refresh }
    refreshRef.current = refresh

    refresh()
    storage.watch(watch)
    return () => {
      active = false
      refreshRef.current = () => {}
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
      writeGenerationRef.current += 1
      void writeSetting(descriptor, resolved)
        .catch((error) => {
          logger.error("Setting write failed", "useSetting", {
            key: descriptor.key,
            error
          })
        })
        .finally(() => {
          pendingWritesRef.current -= 1
          if (pendingWritesRef.current === 0) refreshRef.current()
        })
    },
    [descriptor]
  )

  return [value, setAndPersist, { isLoading }]
}
