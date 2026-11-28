import { z } from "zod"

/** Text already extracted from a user file for context construction. */
export const ContextFileInputSchema = z.object({
  text: z.string(),
  pages: z
    .array(
      z.object({ pageNumber: z.number().int().positive(), text: z.string() })
    )
    .optional(),
  metadata: z.object({
    fileName: z.string(),
    fileId: z.string().optional()
  })
})
