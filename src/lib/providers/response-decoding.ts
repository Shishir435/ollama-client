import type { z } from "zod"
import { createAppError } from "@/lib/error-utils"

interface ProviderResponseContext {
  providerId: string
  providerName?: string
  baseUrl: string
  label: string
  userMessage: string
}

/** Decode an untrusted provider JSON response without exposing its contents. */
export const decodeProviderJson = async <T>(
  response: Response,
  schema: z.ZodType<T>,
  context: ProviderResponseContext
): Promise<T> => {
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw createAppError(
      `Provider returned invalid JSON for ${context.label}`,
      {
        kind: "provider",
        phase: "response",
        providerId: context.providerId,
        providerName: context.providerName,
        baseUrl: context.baseUrl,
        userMessage: context.userMessage
      }
    )
  }

  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw createAppError(`Provider returned an invalid ${context.label}`, {
      kind: "provider",
      phase: "response",
      providerId: context.providerId,
      providerName: context.providerName,
      baseUrl: context.baseUrl,
      userMessage: context.userMessage
    })
  }
  return parsed.data
}
