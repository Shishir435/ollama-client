import { z } from "zod"
import { vectorDb } from "../db"

export const NativeIndexStateSchema = z
  .object({
    id: z.literal("active"),
    mode: z.enum(["external", "bundled"]),
    migration: z.enum(["idle", "building", "changed"]),
    current: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    lastId: z.number().int().nonnegative(),
    generation: z.number().int().nonnegative()
  })
  .strict()
export type NativeIndexState = z.infer<typeof NativeIndexStateSchema>
export interface NativeRebuildRow {
  id: number
  sourceFingerprint: string
  embedding?: number[]
}
export const initialNativeIndexState: NativeIndexState = {
  id: "active",
  mode: "external",
  migration: "idle",
  current: 0,
  total: 0,
  lastId: 0,
  generation: 0
}
/** Kept with the index so replacement vectors and their active space commit atomically. */
export const readNativeIndexState = async (): Promise<NativeIndexState> => {
  const stored = await vectorDb.embeddingState.get("active")
  return stored
    ? NativeIndexStateSchema.parse(stored)
    : { ...initialNativeIndexState }
}

/** Installation alone opts in automatically; an upgrade never changes the existing route. */
export const initializeBundledInstall = async (): Promise<void> => {
  await vectorDb.transaction(
    "rw",
    vectorDb.vectors,
    vectorDb.embeddingState,
    async () => {
      if (
        (await vectorDb.embeddingState.get("active")) ||
        (await vectorDb.vectors.count())
      )
        return
      await vectorDb.embeddingState.put({
        ...initialNativeIndexState,
        mode: "bundled"
      })
    }
  )
}
