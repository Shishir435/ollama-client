import { z } from "zod"
import { MESSAGE_KEYS } from "@/lib/constants"
import { AppFailureSchema } from "@/protocol/app-failure"
import { STREAM_PROTOCOL_VERSION } from "./version"

const version = z.literal(STREAM_PROTOCOL_VERSION)

export const SelectionActionRequestSchema = z.object({
  actionId: z.enum([
    "summarize",
    "rewrite",
    "shorten",
    "fix-grammar",
    "explain",
    "action-items",
    "translate-english",
    "custom"
  ]),
  selection: z.object({
    selectedText: z.string(),
    pageUrl: z.string(),
    pageTitle: z.string(),
    selectionType: z.enum([
      "plain-text",
      "input",
      "textarea",
      "contenteditable",
      "unknown"
    ]),
    canReplace: z.boolean(),
    canInsert: z.boolean(),
    surroundingText: z.string().optional()
  }),
  customInstruction: z.string().optional(),
  model: z.string().optional(),
  providerId: z.string().optional()
})

export const SelectionStreamClientEventSchemas = [
  z.object({
    version,
    type: z.literal(MESSAGE_KEYS.PROVIDER.START_SELECTION_ACTION),
    payload: SelectionActionRequestSchema
  }),
  z.object({
    version,
    type: z.literal(MESSAGE_KEYS.PROVIDER.CANCEL_SELECTION_ACTION)
  })
] as const

export const SelectionStreamServerEventSchemas = [
  z.object({
    version,
    type: z.literal(MESSAGE_KEYS.BROWSER.SELECTION_ACTION_CHUNK),
    payload: z.object({
      delta: z.string(),
      thinkingDelta: z.string()
    })
  }),
  z.object({
    version,
    type: z.literal(MESSAGE_KEYS.BROWSER.SELECTION_ACTION_DONE)
  }),
  z.object({
    version,
    type: z.literal(MESSAGE_KEYS.BROWSER.SELECTION_ACTION_ERROR),
    failure: AppFailureSchema
  })
] as const

export const SelectionStreamClientEventSchema = z.discriminatedUnion(
  "type",
  SelectionStreamClientEventSchemas
)

export const SelectionStreamServerEventSchema = z.discriminatedUnion(
  "type",
  SelectionStreamServerEventSchemas
)

export type SelectionStreamClientEvent = z.infer<
  typeof SelectionStreamClientEventSchema
>
export type SelectionStreamServerEvent = z.infer<
  typeof SelectionStreamServerEventSchema
>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)

export const parseSelectionStreamServerEvent = (value: unknown) => {
  if (!isRecord(value)) return SelectionStreamServerEventSchema.safeParse(value)

  const versioned: Record<string, unknown> = {
    ...value,
    version: value.version ?? STREAM_PROTOCOL_VERSION
  }
  if (
    versioned.type !== MESSAGE_KEYS.BROWSER.SELECTION_ACTION_ERROR ||
    versioned.failure !== undefined
  ) {
    return SelectionStreamServerEventSchema.safeParse(versioned)
  }

  const { error, ...rest } = versioned
  const failure = isRecord(error)
    ? { status: typeof error.status === "number" ? error.status : 0, ...error }
    : {
        status: 0,
        message: "Selection action failed. Try again."
      }
  return SelectionStreamServerEventSchema.safeParse({ ...rest, failure })
}
