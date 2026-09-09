import { z } from "zod"

/**
 * The browser's own name for one document: the tab, the frame within it, and
 * the document currently loaded there. A frame id survives navigation and a
 * document id does not, so the pair is what tells a reference bound before a
 * navigation apart from one bound after it.
 */
export const AgentFrameIdentitySchema = z
  .object({
    tabId: z.number().int().nonnegative(),
    frameId: z.number().int().nonnegative(),
    documentId: z.string().min(1)
  })
  .strict()
export type AgentFrameIdentity = z.infer<typeof AgentFrameIdentitySchema>

/**
 * What a reference is bound to. Every frame keeps its own snapshot and
 * generation, so an element in a child frame is bound to that frame's
 * identity, not to the main frame's — a child that navigated invalidates its
 * own references without pretending the rest of the page moved.
 */
export const AgentSnapshotIdentitySchema = z.object({
  snapshotId: z.string().min(1),
  generation: z.number().int().nonnegative(),
  tabId: z.number().int().nonnegative(),
  frameId: z.number().int().nonnegative(),
  documentId: z.string().min(1)
})
export type AgentSnapshotIdentity = z.infer<typeof AgentSnapshotIdentitySchema>

/** Root frame plus the child frames one observation may carry. */
export const MAX_AGENT_OBSERVED_FRAMES = 12

/**
 * Why a frame is, or is not, part of the observation.
 *
 * `ok` frames contribute elements and text. Every other value names a frame
 * the run knows exists and did not read: the browser refuses content scripts
 * there, the user excluded the site, the frame's origin is one the run was
 * never authorized for, the frame could not be observed, or the element
 * budget was spent before it. The frame is listed either way, because a
 * control the model cannot see is different from a control that is not there.
 * Frames beyond the frame cap are not listed at all; `omittedFrames` counts
 * them, so the list itself stays bounded.
 */
export const AGENT_FRAME_ACCESS = [
  "ok",
  "restricted",
  "excluded",
  "unauthorized_origin",
  "unreadable",
  "element_budget"
] as const
export const AgentFrameAccessSchema = z.enum(AGENT_FRAME_ACCESS)
export type AgentFrameAccess = z.infer<typeof AgentFrameAccessSchema>

export const AgentFrameObservationSchema = z
  .object({
    frameId: z.number().int().nonnegative(),
    /** Absent for the root frame. */
    parentFrameId: z.number().int().nonnegative().optional(),
    documentId: z.string().min(1).optional(),
    origin: z.url(),
    /** Present only for frames the run read; a blocked frame shows its origin alone. */
    url: z.url().max(2_048).optional(),
    access: AgentFrameAccessSchema,
    snapshotId: z.string().min(1).optional(),
    generation: z.number().int().nonnegative().optional()
  })
  .strict()
  .superRefine((frame, context) => {
    const bound =
      frame.documentId !== undefined &&
      frame.url !== undefined &&
      frame.snapshotId !== undefined &&
      frame.generation !== undefined
    if (frame.access === "ok" && !bound) {
      context.addIssue({
        code: "custom",
        path: ["access"],
        message: "An observed frame must carry its document, url and snapshot"
      })
    }
    if (frame.access !== "ok" && frame.url !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["url"],
        message: "A frame the run did not read exposes its origin only"
      })
    }
  })
export type AgentFrameObservation = z.infer<typeof AgentFrameObservationSchema>

export const AgentSelectOptionSchema = z
  .object({
    value: z.string().max(2_000),
    label: z.string().max(500),
    disabled: z.boolean()
  })
  .strict()
export type AgentSelectOption = z.infer<typeof AgentSelectOptionSchema>

export const AgentElementSchema = z
  .object({
    ref: z.string().min(1),
    verificationId: z.string().min(1).max(128).optional(),
    frameId: z.number().int().nonnegative(),
    role: z.string().min(1).optional(),
    name: z.string().optional(),
    tag: z.string().min(1),
    type: z.string().min(1).optional(),
    value: z.string().max(500).optional(),
    checked: z.boolean().optional(),
    focused: z.boolean().optional(),
    href: z.url().max(2_048).optional(),
    download: z.boolean().optional(),
    formAction: z.url().max(2_048).optional(),
    formMethod: z.enum(["get", "post", "dialog"]).optional(),
    formFingerprint: z
      .string()
      .regex(/^[0-9a-f]{8}$/)
      .optional(),
    formHasSensitiveControl: z.boolean().optional(),
    maySubmit: z.boolean().optional(),
    submitter: z.boolean().optional(),
    options: z.array(AgentSelectOptionSchema).max(200).optional(),
    visible: z.boolean(),
    enabled: z.boolean(),
    editable: z.boolean(),
    sensitive: z.boolean(),
    /**
     * The landmark, form or dialog this element belongs to. Duplicate labels
     * are common and a flat list gives a decision no way to tell two
     * identically named controls apart; the group is what does.
     */
    group: z.string().min(1).max(80).optional()
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
    if (element.formAction !== undefined && !element.maySubmit) {
      context.addIssue({
        code: "custom",
        path: ["formAction"],
        message: "A form destination requires submit semantics"
      })
    }
    if (element.options !== undefined && element.tag !== "select") {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "Only select elements may expose options"
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

/**
 * An open in-page dialog or menu.
 *
 * Deliberately not `dialogs`, which is typed for `alert`, `confirm`, `prompt`
 * and `beforeunload` — native dialogs block the page and are genuinely
 * unobservable from a content script. A `<dialog open>` or `[role=dialog]` is
 * ordinary DOM, and the run needs to know which one owns the controls it can
 * see: acting on the opener behind a modal is the loop the fixtures showed.
 */
export const AgentModalStateSchema = z
  .object({
    id: z.string().min(1).max(80),
    kind: z.enum(["dialog", "alertdialog", "menu", "listbox"]),
    label: z.string().max(200).optional(),
    modal: z.boolean().optional()
  })
  .strict()
export type AgentModalState = z.infer<typeof AgentModalStateSchema>

/** Elements one observation may carry, across every frame it read. */
export const MAX_AGENT_OBSERVED_ELEMENTS = 2_000

export const AgentObservationSchema = AgentSnapshotIdentitySchema.extend({
  url: z.url(),
  origin: z.url(),
  title: z.string().max(500),
  /**
   * Every frame the page holds, read or not, root first. Elements name their
   * frame by id, and an id that is not in this list — or is listed as not
   * read — is an element the observation could not have produced.
   */
  frames: z
    .array(AgentFrameObservationSchema)
    .min(1)
    .max(MAX_AGENT_OBSERVED_FRAMES),
  /** Child frames with an origin that the frame cap left unread and unlisted. */
  omittedFrames: z.number().int().positive().optional(),
  elements: z.array(AgentElementSchema).max(MAX_AGENT_OBSERVED_ELEMENTS),
  visibleText: z.string().max(100_000),
  /**
   * The document's own text, beyond the viewport, so a question the page
   * answers below the fold does not have to be reached by scrolling — which
   * costs an observation each time and is how a reading task exhausted its
   * budget.
   */
  documentText: z.string().max(30_000).optional(),
  /** Set when the document had more text than the cap allowed, so an absent
   * fact is not read as a fact the page does not state. */
  documentTextTruncated: z.boolean().optional(),
  scroll: AgentScrollStateSchema,
  dialogs: z.array(AgentDialogStateSchema).max(10),
  modals: z.array(AgentModalStateSchema).max(10).optional(),
  capturedAt: z.number().int().nonnegative()
})
  .strict()
  .superRefine((observation, context) => {
    const root = observation.frames[0]
    if (
      root.frameId !== observation.frameId ||
      root.documentId !== observation.documentId ||
      root.snapshotId !== observation.snapshotId ||
      root.generation !== observation.generation ||
      root.parentFrameId !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["frames", 0],
        message: "The first frame must be the observation's own root frame"
      })
    }
    const ids = new Set<number>()
    const readable = new Set<number>()
    observation.frames.forEach((frame, index) => {
      if (ids.has(frame.frameId)) {
        context.addIssue({
          code: "custom",
          path: ["frames", index, "frameId"],
          message: "Frame ids must be unique within an observation"
        })
      }
      ids.add(frame.frameId)
      if (frame.access === "ok") readable.add(frame.frameId)
    })
    observation.elements.forEach((element, index) => {
      if (!readable.has(element.frameId)) {
        context.addIssue({
          code: "custom",
          path: ["elements", index, "frameId"],
          message: "Elements may only come from a frame the run read"
        })
      }
    })
  })
export type AgentObservation = z.infer<typeof AgentObservationSchema>
