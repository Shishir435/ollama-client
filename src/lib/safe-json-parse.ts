import type { ZodError, ZodSchema } from "zod"

export type SafeJsonParseResult<T> =
  | { success: true; data: T; error?: never }
  | { success: false; data?: never; error: ZodError | SyntaxError }

/**
 * Return JSON syntax and schema validation failures as data.
 * Exceptions thrown by custom schema transforms still propagate.
 */
export function safeJsonParse<T>(
  raw: string,
  schema: ZodSchema<T>
): SafeJsonParseResult<T> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    return { success: false, error: e as SyntaxError }
  }
  const result = schema.safeParse(parsed)
  if (result.success) {
    return { success: true, data: result.data }
  }
  return { success: false, error: result.error }
}
