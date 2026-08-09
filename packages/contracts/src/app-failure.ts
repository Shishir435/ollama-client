import { z } from "zod"

export const AppFailureSchema = z.object({
  status: z.number().int().nonnegative(),
  message: z.string(),
  kind: z
    .enum(["network", "provider", "storage", "validation", "abort", "unknown"])
    .optional(),
  messageKey: z.string().optional(),
  userMessage: z.string().optional(),
  retryable: z.boolean().optional(),
  retryAfterMs: z.number().nonnegative().optional(),
  context: z.string().optional(),
  providerId: z.string().optional(),
  providerName: z.string().optional(),
  model: z.string().optional(),
  baseUrl: z.string().optional(),
  code: z
    .enum([
      "OLC-PROVIDER-DISABLED",
      "OLC-PROVIDER-UNREACHABLE",
      "OLC-PROVIDER-HTTP",
      "OLC-MODEL-NOT-FOUND",
      "OLC-RESOURCE-NOT-FOUND",
      "OLC-MODEL-NOT-LOADED",
      "OLC-CORS-BLOCKED",
      "OLC-AUTH-FAILED",
      "OLC-PAYMENT-REQUIRED",
      "OLC-CONTEXT-TOO-LARGE",
      "OLC-INPUT-UNSUPPORTED",
      "OLC-OUT-OF-MEMORY",
      "OLC-MODEL-LOADING",
      "OLC-RATE-LIMITED",
      "OLC-PROVIDER-OVERLOADED",
      "OLC-PROVIDER-TIMEOUT",
      "OLC-STREAM-DROPPED",
      "OLC-UNKNOWN"
    ])
    .optional(),
  phase: z
    .enum([
      "configuration",
      "connect",
      "response",
      "read-stream",
      "tool",
      "persistence",
      "unknown"
    ])
    .optional(),
  incidentId: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
  recoveryAction: z
    .enum([
      "retry",
      "enable-provider",
      "test-connection",
      "choose-model",
      "reduce-input",
      "wait-retry",
      "open-diagnostics"
    ])
    .optional()
})

export type AppFailure = z.infer<typeof AppFailureSchema>
