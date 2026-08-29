import { z } from "zod"
import { approvalGrantKey } from "@/lib/tools/approval/approval-policy"
import { TOOL_FAMILIES } from "@/lib/tools/tool-families"

const ModelCapabilityOverrideSchema = z
  .object({
    text: z.boolean().optional(),
    vision: z.boolean().optional(),
    imageOutput: z.boolean().optional(),
    embeddings: z.boolean().optional(),
    toolCalling: z.boolean().optional(),
    reasoning: z.boolean().optional(),
    contextLength: z.number().int().positive().optional()
  })
  .strict()

export const ModelCapabilityOverrideMapSchema = z.record(
  z.string(),
  ModelCapabilityOverrideSchema
)

const CapabilityProbeResultSchema = z
  .object({
    toolCalling: z.boolean().optional(),
    toolCallingMode: z.enum(["native", "native-user-results"]).optional(),
    toolCallingProbeVersion: z.number().int().positive().optional(),
    reasoning: z.boolean().optional(),
    vision: z.boolean().optional(),
    incomplete: z
      .array(z.enum(["toolCalling", "reasoning", "vision"]))
      .optional(),
    probedAt: z.number().finite().nonnegative()
  })
  .strict()

export const CapabilityProbeMapSchema = z.record(
  z.string(),
  CapabilityProbeResultSchema
)

const ApprovalGrantSchema = z
  .object({
    toolName: z.string().min(1),
    origin: z.string().min(1),
    grantedAt: z.number().finite().nonnegative()
  })
  .strict()

export const ApprovalGrantMapSchema = z
  .record(z.string(), ApprovalGrantSchema)
  .superRefine((grants, context) => {
    for (const [key, grant] of Object.entries(grants)) {
      if (key !== approvalGrantKey(grant.toolName, grant.origin)) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: "Grant key does not match its tool and origin"
        })
      }
    }
  })

const ToolFamilySchema = z.enum(
  TOOL_FAMILIES as [
    (typeof TOOL_FAMILIES)[number],
    ...(typeof TOOL_FAMILIES)[number][]
  ]
)

const ToolFamilyOverrideSchema = z
  .object({
    enabled: z.boolean().optional(),
    families: z.partialRecord(ToolFamilySchema, z.boolean()).optional(),
    nonNativeToolFallback: z.boolean().optional()
  })
  .strict()

export const ToolModelOverrideMapSchema = z.record(
  z.string(),
  ToolFamilyOverrideSchema
)
