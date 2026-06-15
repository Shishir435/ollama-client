/**
 * Apply a batch of settings writes across `@plasmohq/storage`.
 *
 * Both presets (item 11) and per-card reset (item 12) reduce to "write these
 * values to these storage keys." A write is either a scalar key
 * (`chat-grounded-only-mode`) or one field inside a config object stored under
 * a single key (`embeddings-config.chunkSize`). This util groups writes by key
 * so a config object is read once, patched with all its field updates, and
 * written back once — never clobbering sibling fields.
 *
 * Writes go through `setPlasmoStoredValue`, which routes each key to the right
 * storage area (sync vs device-local) per the storage-key registry. Components
 * read these keys through `useStorage`, which watches storage, so the UI
 * refreshes on its own — no manual store refresh needed.
 */

import {
  getPlasmoStoredValue,
  setPlasmoStoredValue
} from "@/lib/plasmo-global-storage"

export interface SettingWrite {
  /** The storage key to write. */
  storageKey: string
  /** Property name inside a config-object key; omit for a scalar key. */
  field?: string
  /** The value to write. */
  value: unknown
}

export const applyStorageWrites = async (
  writes: SettingWrite[]
): Promise<void> => {
  const byKey = new Map<string, SettingWrite[]>()
  for (const write of writes) {
    const group = byKey.get(write.storageKey)
    if (group) group.push(write)
    else byKey.set(write.storageKey, [write])
  }

  await Promise.all(
    Array.from(byKey.entries()).map(async ([key, group]) => {
      const fieldWrites = group.filter((w) => w.field)
      // Scalar key: a single fieldless write replaces the whole value.
      if (fieldWrites.length === 0) {
        await setPlasmoStoredValue(key, group[group.length - 1].value)
        return
      }
      // Config-object key: merge all field updates into the current object.
      const current =
        (await getPlasmoStoredValue<Record<string, unknown>>(key)) ?? {}
      const next: Record<string, unknown> = { ...current }
      for (const write of fieldWrites) {
        if (write.field) next[write.field] = write.value
      }
      await setPlasmoStoredValue(key, next)
    })
  )
}
