import { z } from "zod"

export const AgentSnapshotIdentitySchema = z.object({
  snapshotId: z.string().min(1),
  generation: z.number().int().nonnegative(),
  tabId: z.number().int().nonnegative(),
  documentId: z.string().min(1)
})
export type AgentSnapshotIdentity = z.infer<typeof AgentSnapshotIdentitySchema>

export const AgentElementSchema = z
  .object({
    ref: z.string().min(1),
    frameId: z.number().int().nonnegative(),
    role: z.string().min(1).optional(),
    name: z.string().optional(),
    tag: z.string().min(1),
    type: z.string().min(1).optional(),
    value: z.string().optional(),
    href: z.url().max(2_048).optional(),
    download: z.boolean().optional(),
    visible: z.boolean(),
    enabled: z.boolean(),
    editable: z.boolean(),
    sensitive: z.boolean()
  })
  .strict()
  .superRefine((element, context) => {
    if (element.sensitive && element.value !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "Sensitive element values must be omitted"
      })
    }
    if (element.href !== undefined && !element.visible) {
      context.addIssue({
        code: "custom",
        path: ["href"],
        message: "Hidden element destinations must be omitted"
      })
    }
  })
export type AgentElement = z.infer<typeof AgentElementSchema>

export const AgentScrollStateSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  viewportWidth: z.number().finite().nonnegative(),
  viewportHeight: z.number().finite().nonnegative(),
  documentWidth: z.number().finite().nonnegative(),
  documentHeight: z.number().finite().nonnegative()
})
export type AgentScrollState = z.infer<typeof AgentScrollStateSchema>

export const AgentDialogStateSchema = z.object({
  type: z.enum(["alert", "confirm", "prompt", "beforeunload"]),
  message: z.string().max(500)
})
export type AgentDialogState = z.infer<typeof AgentDialogStateSchema>

export const AgentObservationSchema = AgentSnapshotIdentitySchema.extend({
  url: z.url(),
  origin: z.url(),
  title: z.string().max(500),
  elements: z.array(AgentElementSchema).max(2_000),
  visibleText: z.string().max(100_000),
  scroll: AgentScrollStateSchema,
  dialogs: z.array(AgentDialogStateSchema).max(10),
  capturedAt: z.number().int().nonnegative()
}).strict()
export type AgentObservation = z.infer<typeof AgentObservationSchema>
