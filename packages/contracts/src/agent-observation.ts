import { z } from "zod"

export const AgentSnapshotIdentitySchema = z.object({
  snapshotId: z.string().min(1),
  generation: z.number().int().nonnegative(),
  tabId: z.number().int().nonnegative(),
  documentId: z.string().min(1)
})
export type AgentSnapshotIdentity = z.infer<typeof AgentSnapshotIdentitySchema>

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

export const AgentObservationSchema = AgentSnapshotIdentitySchema.extend({
  url: z.url(),
  origin: z.url(),
  title: z.string().max(500),
  elements: z.array(AgentElementSchema).max(2_000),
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
}).strict()
export type AgentObservation = z.infer<typeof AgentObservationSchema>
