import { BrowserModelAvailabilitySchema } from "@ollama-client/contracts/provider-rpc"
import { z } from "zod"

/** Private background-to-document streaming transport, separate from page RPC. */
export const BROWSER_MODEL_PORT = "browser-built-in-host-v1"
export const HostRequestSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("status") }).strict(),
  z.object({ op: z.literal("prepare") }).strict(),
  z
    .object({
      op: z.literal("stream"),
      messages: z
        .array(
          z
            .object({
              role: z.enum(["system", "user", "assistant"]),
              content: z.string().max(8_000_000)
            })
            .strict()
        )
        .min(1)
        .max(4096)
    })
    .strict()
    .refine(
      (request) =>
        request.messages.reduce(
          (total, message) => total + message.content.length,
          0
        ) <= 8_000_000
    )
])
export const HostEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("status"),
      availability: BrowserModelAvailabilitySchema
    })
    .strict(),
  z.object({ type: z.literal("delta"), delta: z.string() }).strict(),
  z.object({ type: z.literal("done") }).strict(),
  z.object({ type: z.literal("heartbeat") }).strict(),
  z
    .object({
      type: z.literal("error"),
      code: z.enum([
        "unavailable",
        "not-ready",
        "failed",
        "unsupported",
        "context-too-large",
        "busy",
        "timeout"
      ])
    })
    .strict()
])
export type HostRequest = z.infer<typeof HostRequestSchema>
export type HostEvent = z.infer<typeof HostEventSchema>
