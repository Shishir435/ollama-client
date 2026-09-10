import { z } from "zod"

import { AgentSnapshotIdentitySchema } from "./agent-observation"

/**
 * The longest edge a screenshot the model sees may have, and the most bytes
 * its encoding may carry. Vision models downscale past roughly this size
 * anyway, so a larger image costs tokens and bandwidth for no more detail.
 */
export const MAX_AGENT_SCREENSHOT_EDGE_PX = 1_280
export const MAX_AGENT_SCREENSHOT_BASE64_CHARS = 1_400_000

/** How far a zoom may magnify: past this the page's own pixels are exhausted. */
export const MAX_AGENT_SCREENSHOT_ZOOM = 2

/** A rectangle in CSS pixels of the root frame's layout viewport. */
export const AgentCssRectSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive()
  })
  .strict()
export type AgentCssRect = z.infer<typeof AgentCssRectSchema>

/**
 * One ephemeral picture of the controlled tab, bound to the observation it was
 * taken with.
 *
 * It carries the same snapshot identity as the DOM observation, so a command
 * grounded in it is grounded in one generation of one document — a picture of
 * an earlier page can no more authorize a click than an earlier element list
 * can. `region` is the part of the layout viewport the image shows, in CSS
 * pixels, and `scale` how many image pixels one CSS pixel became: together
 * they convert an image coordinate the model returns into the point the page
 * itself measures, whatever the device scale, browser zoom, pinch zoom or crop
 * did on the way. It is never persisted, logged or shown outside the decision
 * it was taken for.
 */
export const AgentScreenshotSchema = AgentSnapshotIdentitySchema.extend({
  capturedAt: z.number().int().nonnegative(),
  mimeType: z.enum(["image/jpeg", "image/png"]),
  data: z.string().min(1).max(MAX_AGENT_SCREENSHOT_BASE64_CHARS),
  imageWidth: z.number().int().positive().max(MAX_AGENT_SCREENSHOT_EDGE_PX),
  imageHeight: z.number().int().positive().max(MAX_AGENT_SCREENSHOT_EDGE_PX),
  region: AgentCssRectSchema,
  scale: z.number().finite().positive(),
  /** The document scroll position at capture, to tell a moved page from the pictured one. */
  scroll: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
  /** Sensitive controls painted over before the image left the device. */
  maskedRegions: z.number().int().nonnegative(),
  /** Set when the image is a magnified crop rather than the whole viewport. */
  zoomed: z.boolean().optional()
}).strict()
export type AgentScreenshot = z.infer<typeof AgentScreenshotSchema>

/** A point in a screenshot's own pixels, as a vision model reports one. */
export const AgentImagePointSchema = z
  .object({
    x: z.number().finite().nonnegative(),
    y: z.number().finite().nonnegative()
  })
  .strict()
export type AgentImagePoint = z.infer<typeof AgentImagePointSchema>

export const AgentImageRectSchema = AgentImagePointSchema.extend({
  width: z.number().finite().positive(),
  height: z.number().finite().positive()
}).strict()
export type AgentImageRect = z.infer<typeof AgentImageRectSchema>
