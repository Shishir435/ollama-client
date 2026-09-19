import {
  AGENT_CONTROL_FAILURE_REASONS,
  AgentControlFailedError,
  type AgentControlFailureReason,
  AgentEffectNotAppliedError,
  type AgentSchemaIssue
} from "@ollama-client/agent-runtime"
import {
  AgentCommandSchema,
  AgentCssRectSchema,
  AgentElementSchema,
  type AgentObservation,
  AgentObservationSchema,
  type AgentObservationScope,
  AgentObservationScopeSchema,
  type AgentPageTool,
  AgentPageToolInputSchema,
  AgentPageToolSchema,
  AgentSnapshotIdentitySchema,
  MAX_AGENT_FORM_FIELDS,
  MAX_AGENT_LOOKUP_QUERIES,
  MAX_AGENT_OBSERVED_ELEMENTS,
  MAX_AGENT_PAGE_TOOLS,
  MAX_AGENT_TEXT_CHARS
} from "@ollama-client/contracts"
import { z } from "zod"

import { browser } from "@/lib/browser-api"
import {
  classifyAgentTabAccess,
  type TabAccess
} from "@/lib/browser-tab-access"
import { MESSAGE_KEYS } from "@/lib/constants"
import { AGENT_WEBMCP_COMPILED } from "@/lib/feature-flags"
import {
  AGENT_EFFECT_REJECTION_FIELDS,
  AGENT_EFFECT_REJECTION_REASONS,
  AGENT_EFFECT_REJECTIONS,
  agentRejectionField,
  agentRejectionMessage,
  agentRejectionReason
} from "./effect-rejection"

export const AGENT_CONTROL_VERSION = 1 as const

export const AgentObserveRequestSchema = z
  .object({
    version: z.literal(AGENT_CONTROL_VERSION),
    type: z.literal("agent_observe"),
    runId: z.string().min(1),
    tabId: z.number().int().nonnegative(),
    frameId: z.number().int().nonnegative(),
    nonce: z.string().min(16).max(256),
    sequence: z.number().int().positive(),
    documentId: z.string().min(1),
    minimumGeneration: z.number().int().nonnegative(),
    textOffset: z.number().int().min(0).max(10_000_000).optional(),
    /** A scoped read: the elements are the matches, not the overview. */
    scope: AgentObservationScopeSchema.optional(),
    /** Several scoped questions, answered by one walk of the document. */
    lookup: z
      .object({
        queries: z
          .array(z.string().min(1).max(100))
          .min(1)
          .max(MAX_AGENT_LOOKUP_QUERIES)
      })
      .strict()
      .optional(),
    /** Elements this frame may contribute to a composed observation. */
    elementLimit: z
      .number()
      .int()
      .nonnegative()
      .max(MAX_AGENT_OBSERVED_ELEMENTS)
      .optional()
  })
  .strict()
export type AgentObserveRequest = z.infer<typeof AgentObserveRequestSchema>

export const AgentObserveResponseSchema = z
  .object({
    version: z.literal(AGENT_CONTROL_VERSION),
    type: z.literal("agent_observation"),
    runId: z.string().min(1),
    tabId: z.number().int().nonnegative(),
    frameId: z.number().int().nonnegative(),
    nonce: z.string().min(16).max(256),
    sequence: z.number().int().positive(),
    documentId: z.string().min(1),
    observation: AgentObservationSchema
  })
  .strict()
export type AgentObserveResponse = z.infer<typeof AgentObserveResponseSchema>

export const AGENT_CONTROL_MAX_SCHEMA_ISSUES = 20

const AgentControlIssueSchema = z
  .object({
    path: z.string().min(1).max(200),
    code: z.string().min(1).max(64)
  })
  .strict()

/**
 * The answer a bound request gets when the content script cannot produce a
 * response. It carries the same binding as a successful reply, so a failure
 * cannot be replayed against a different run, tab or sequence, and it carries
 * schema paths and rule codes rather than the values that were rejected.
 */
export const AgentControlFailureResponseSchema = z
  .object({
    version: z.literal(AGENT_CONTROL_VERSION),
    type: z.literal("agent_control_failed"),
    runId: z.string().min(1),
    tabId: z.number().int().nonnegative(),
    frameId: z.number().int().nonnegative(),
    nonce: z.string().min(16).max(256),
    sequence: z.number().int().positive(),
    documentId: z.string().min(1),
    reason: z.enum(AGENT_CONTROL_FAILURE_REASONS),
    issues: z
      .array(AgentControlIssueSchema)
      .max(AGENT_CONTROL_MAX_SCHEMA_ISSUES)
  })
  .strict()
export type AgentControlFailureResponse = z.infer<
  typeof AgentControlFailureResponseSchema
>

/**
 * Structural evidence from a schema rejection, capped and stripped of values.
 */
export const agentControlSchemaIssues = (error: unknown): AgentSchemaIssue[] =>
  error instanceof z.ZodError
    ? error.issues.slice(0, AGENT_CONTROL_MAX_SCHEMA_ISSUES).map((issue) => ({
        path: (issue.path.map(String).join(".") || "(root)").slice(0, 200),
        code: String(issue.code).slice(0, 64) || "invalid"
      }))
    : []

/**
 * A failure only counts when it is bound to the request in flight. An
 * unbound one is left to the response validators, which reject it and close
 * the port, because a reply that cannot prove its origin is not a diagnostic.
 */
export const readAgentControlFailure = (
  raw: unknown,
  binding: AgentControlBinding,
  sequence: number
): AgentControlFailedError | undefined => {
  const parsed = AgentControlFailureResponseSchema.safeParse(raw)
  if (!parsed.success) return undefined
  const response = parsed.data
  if (
    response.runId !== binding.runId ||
    response.tabId !== binding.tabId ||
    response.frameId !== binding.frameId ||
    response.nonce !== binding.nonce ||
    response.documentId !== binding.documentId ||
    response.sequence !== sequence
  ) {
    return undefined
  }
  return new AgentControlFailedError({
    reason: response.reason,
    issues: response.issues
  })
}

const AgentDomMutationTargetSchema = z
  .object({
    ref: z.string().min(1),
    verificationId: z.string().min(1).max(128).optional(),
    frameId: z.number().int().nonnegative(),
    tag: z.string().min(1),
    role: z.string().min(1).optional(),
    accessibleName: z.string().max(500).optional(),
    inputType: z.string().min(1).optional(),
    observedValue: z.string().max(MAX_AGENT_TEXT_CHARS).optional(),
    observedChecked: z.boolean().optional(),
    observedFocused: z.boolean().optional(),
    href: z.url().max(2_048).optional(),
    formAction: z.url().max(2_048).optional(),
    formMethod: z.enum(["get", "post", "dialog"]).optional(),
    formFingerprint: z
      .string()
      .regex(/^[0-9a-f]{8}$/)
      .optional(),
    formHasSensitiveControl: z.boolean().optional(),
    submitter: z.boolean().optional(),
    expectedValue: z.string().max(MAX_AGENT_TEXT_CHARS).optional(),
    expectedChecked: z.boolean().optional(),
    /** Where a drag is released; the page rechecks it like the source. */
    drop: z
      .object({
        ref: z.string().min(1),
        verificationId: z.string().min(1).max(128).optional(),
        frameId: z.number().int().nonnegative(),
        tag: z.string().min(1),
        role: z.string().min(1).optional(),
        accessibleName: z.string().max(500).optional()
      })
      .strict()
      .optional(),
    sensitive: z.boolean(),
    maySubmit: z.boolean()
  })
  .strict()

const AgentDomMutationCommandSchema = AgentCommandSchema.refine(
  (command) =>
    [
      "click",
      "click_point",
      "double_click",
      "hover",
      "type",
      "clear_and_type",
      "replace_text",
      "drag",
      "select",
      "check",
      "uncheck",
      "press_key"
    ].includes(command.type),
  "Control-port execution accepts only DOM mutation commands"
)

/**
 * The command names the root snapshot; the target's frame holds its own. The
 * two agree on the tab, and when the target is in the root frame they are the
 * same identity — a frame identity that disagrees with the root it claims to
 * be is a fabricated binding, not a child frame.
 */
const assertFrameBinding = (
  instruction: {
    command: { snapshotId: string; generation: number }
    snapshotIdentity: z.infer<typeof AgentSnapshotIdentitySchema>
    frame: z.infer<typeof AgentSnapshotIdentitySchema>
    target?: { frameId: number }
  },
  context: z.RefinementCtx
): void => {
  if (
    instruction.command.snapshotId !==
      instruction.snapshotIdentity.snapshotId ||
    instruction.command.generation !== instruction.snapshotIdentity.generation
  ) {
    context.addIssue({
      code: "custom",
      path: ["command"],
      message: "Command and resolved snapshot identity must match"
    })
  }
  const root = instruction.snapshotIdentity
  const frame = instruction.frame
  const sameFrame = frame.frameId === root.frameId
  if (
    frame.tabId !== root.tabId ||
    (sameFrame &&
      (frame.snapshotId !== root.snapshotId ||
        frame.generation !== root.generation ||
        frame.documentId !== root.documentId))
  ) {
    context.addIssue({
      code: "custom",
      path: ["frame"],
      message: "Frame identity must belong to the resolved snapshot's tab"
    })
  }
  if (instruction.target && instruction.target.frameId !== frame.frameId) {
    context.addIssue({
      code: "custom",
      path: ["target", "frameId"],
      message: "Target frame and frame identity must agree"
    })
  }
}

export const AgentDomMutationInstructionSchema = z
  .object({
    command: AgentDomMutationCommandSchema,
    target: AgentDomMutationTargetSchema,
    snapshotIdentity: AgentSnapshotIdentitySchema,
    frame: AgentSnapshotIdentitySchema,
    /** Only a visual click names one, and only in the root frame. */
    point: z
      .object({ x: z.number().finite(), y: z.number().finite() })
      .strict()
      .optional()
  })
  .strict()
  .superRefine(assertFrameBinding)
  .superRefine((instruction, context) => {
    if (instruction.point && instruction.frame.frameId !== 0) {
      context.addIssue({
        code: "custom",
        path: ["point"],
        message: "A visual point is measured in the root frame only"
      })
    }
    if (
      instruction.target.drop &&
      instruction.target.drop.frameId !== instruction.target.frameId
    ) {
      context.addIssue({
        code: "custom",
        path: ["target", "drop", "frameId"],
        message: "A drag stays within the frame it starts in"
      })
    }
  })
export type AgentDomMutationInstruction = z.infer<
  typeof AgentDomMutationInstructionSchema
>

export const AgentExecuteRequestSchema = z
  .object({
    version: z.literal(AGENT_CONTROL_VERSION),
    type: z.literal("agent_execute_dom_mutation"),
    runId: z.string().min(1),
    tabId: z.number().int().nonnegative(),
    frameId: z.number().int().nonnegative(),
    nonce: z.string().min(16).max(256),
    sequence: z.number().int().positive(),
    documentId: z.string().min(1),
    instruction: AgentDomMutationInstructionSchema
  })
  .strict()
export type AgentExecuteRequest = z.infer<typeof AgentExecuteRequestSchema>

export const AgentExecuteResponseSchema = z
  .object({
    version: z.literal(AGENT_CONTROL_VERSION),
    type: z.enum([
      "agent_dom_mutation_executed",
      "agent_dom_mutation_rejected"
    ]),
    runId: z.string().min(1),
    tabId: z.number().int().nonnegative(),
    frameId: z.number().int().nonnegative(),
    nonce: z.string().min(16).max(256),
    sequence: z.number().int().positive(),
    documentId: z.string().min(1),
    /**
     * Why the page refused, when it did. A closed vocabulary this build
     * composes, so a refusal reaches the run as a cause rather than as the
     * one sentence every refusal used to share.
     */
    rejection: z.enum(AGENT_EFFECT_REJECTION_REASONS).optional(),
    /** Which identity field moved, when the refusal named one. */
    rejectionField: z.enum(AGENT_EFFECT_REJECTION_FIELDS).optional(),
    submissionUrl: z.url().max(32_768).optional()
  })
  .strict()
export type AgentExecuteResponse = z.infer<typeof AgentExecuteResponseSchema>

const AgentFormFillCommandSchema = AgentCommandSchema.refine(
  (command) => command.type === "fill_form",
  "Control-port form filling accepts only fill_form commands"
)

/**
 * A batch of value edits, each already resolved and approved as the
 * single-field command it mirrors.
 *
 * The fields carry whole grounded commands rather than a shorthand, so the
 * page applies each one through exactly the path a lone `clear_and_type` takes
 * — same target recheck, same sensitivity refusal, same rejection vocabulary.
 * A batch that spoke its own dialect would be a second executor, and the two
 * would disagree the first time either changed.
 */
export const AgentFormFillInstructionSchema = z
  .object({
    command: AgentFormFillCommandSchema,
    snapshotIdentity: AgentSnapshotIdentitySchema,
    frame: AgentSnapshotIdentitySchema,
    fields: z
      .array(
        z
          .object({
            command: AgentDomMutationCommandSchema,
            target: AgentDomMutationTargetSchema
          })
          .strict()
      )
      .min(1)
      .max(MAX_AGENT_FORM_FIELDS)
  })
  .strict()
  .superRefine(assertFrameBinding)
  .superRefine((instruction, context) => {
    for (const [index, field] of instruction.fields.entries()) {
      if (field.target.frameId === instruction.frame.frameId) continue
      context.addIssue({
        code: "custom",
        path: ["fields", index, "target", "frameId"],
        message: "A batched fill stays within one frame"
      })
    }
  })
export type AgentFormFillInstruction = z.infer<
  typeof AgentFormFillInstructionSchema
>

export const AgentExecuteFormFillRequestSchema = z
  .object({
    version: z.literal(AGENT_CONTROL_VERSION),
    type: z.literal("agent_execute_form_fill"),
    runId: z.string().min(1),
    tabId: z.number().int().nonnegative(),
    frameId: z.number().int().nonnegative(),
    nonce: z.string().min(16).max(256),
    sequence: z.number().int().positive(),
    documentId: z.string().min(1),
    instruction: AgentFormFillInstructionSchema
  })
  .strict()
export type AgentExecuteFormFillRequest = z.infer<
  typeof AgentExecuteFormFillRequestSchema
>

/**
 * What the page did, as counts and a closed reason.
 *
 * `applied` is how many fields landed, in the order they were sent, so a
 * partial batch is legible without the page getting to describe itself: the
 * run already knows which field is which, and a count is the only thing it
 * cannot work out for itself. Nothing page-authored travels.
 */
export const AgentFormFillResponseSchema = z
  .object({
    version: z.literal(AGENT_CONTROL_VERSION),
    type: z.literal("agent_form_fill_executed"),
    runId: z.string().min(1),
    tabId: z.number().int().nonnegative(),
    frameId: z.number().int().nonnegative(),
    nonce: z.string().min(16).max(256),
    sequence: z.number().int().positive(),
    documentId: z.string().min(1),
    applied: z.number().int().nonnegative().max(MAX_AGENT_FORM_FIELDS),
    /** Why the batch stopped, when it stopped before the end. */
    rejection: z.enum(AGENT_EFFECT_REJECTION_REASONS).optional(),
    rejectionField: z.enum(AGENT_EFFECT_REJECTION_FIELDS).optional()
  })
  .strict()
export type AgentFormFillResponse = z.infer<typeof AgentFormFillResponseSchema>

export interface AgentFormFillOutcome {
  applied: number
  rejection?: (typeof AGENT_EFFECT_REJECTION_REASONS)[number]
  rejectionField?: (typeof AGENT_EFFECT_REJECTION_FIELDS)[number]
}

const AgentScrollCommandSchema = AgentCommandSchema.refine(
  (command) => command.type === "scroll",
  "Control-port scrolling accepts only scroll commands"
)

/**
 * Scrolling is page-side work like DOM mutation: it needs the in-page
 * reference store to resolve `ref` and to prove the snapshot is still live, so
 * it travels the control port rather than a separate injection.
 */
export const AgentScrollInstructionSchema = z
  .object({
    command: AgentScrollCommandSchema,
    snapshotIdentity: AgentSnapshotIdentitySchema,
    frame: AgentSnapshotIdentitySchema
  })
  .strict()
  .superRefine(assertFrameBinding)
export type AgentScrollInstruction = z.infer<
  typeof AgentScrollInstructionSchema
>

export const AgentExecuteScrollRequestSchema = z
  .object({
    version: z.literal(AGENT_CONTROL_VERSION),
    type: z.literal("agent_execute_scroll"),
    runId: z.string().min(1),
    tabId: z.number().int().nonnegative(),
    frameId: z.number().int().nonnegative(),
    nonce: z.string().min(16).max(256),
    sequence: z.number().int().positive(),
    documentId: z.string().min(1),
    instruction: AgentScrollInstructionSchema
  })
  .strict()
export type AgentExecuteScrollRequest = z.infer<
  typeof AgentExecuteScrollRequestSchema
>

export const AgentScrollResponseSchema = z
  .object({
    version: z.literal(AGENT_CONTROL_VERSION),
    type: z.literal("agent_scroll_executed"),
    runId: z.string().min(1),
    tabId: z.number().int().nonnegative(),
    frameId: z.number().int().nonnegative(),
    nonce: z.string().min(16).max(256),
    sequence: z.number().int().positive(),
    documentId: z.string().min(1)
  })
  .strict()
export type AgentScrollResponse = z.infer<typeof AgentScrollResponseSchema>

/**
 * Native input is prepared in the page and dispatched from the background.
 * The page rechecks the approved target, brings it into view, picks the point
 * a pointer can reach and starts recording what the document receives; the
 * background sends the events through the debugger; the page is then asked
 * what arrived. Coordinates are the frame's own viewport pixels — the
 * background places the frame, never the page.
 */
export const AgentPrepareNativeInputRequestSchema = z
  .object({
    version: z.literal(AGENT_CONTROL_VERSION),
    type: z.literal("agent_prepare_native_input"),
    runId: z.string().min(1),
    tabId: z.number().int().nonnegative(),
    frameId: z.number().int().nonnegative(),
    nonce: z.string().min(16).max(256),
    sequence: z.number().int().positive(),
    documentId: z.string().min(1),
    instruction: AgentDomMutationInstructionSchema
  })
  .strict()
export type AgentPrepareNativeInputRequest = z.infer<
  typeof AgentPrepareNativeInputRequestSchema
>

const AgentInputPointSchema = z
  .object({ x: z.number().finite(), y: z.number().finite() })
  .strict()

export const AgentPrepareNativeInputResponseSchema = z
  .object({
    version: z.literal(AGENT_CONTROL_VERSION),
    type: z.enum([
      "agent_native_input_prepared",
      "agent_native_input_rejected"
    ]),
    runId: z.string().min(1),
    tabId: z.number().int().nonnegative(),
    frameId: z.number().int().nonnegative(),
    nonce: z.string().min(16).max(256),
    sequence: z.number().int().positive(),
    documentId: z.string().min(1),
    point: AgentInputPointSchema.optional(),
    focused: z.boolean().optional(),
    /** Where a drag is released, in the same frame's viewport pixels. */
    dropPoint: AgentInputPointSchema.optional(),
    /** Why preparation refused, from the same closed vocabulary. */
    rejection: z.enum(AGENT_EFFECT_REJECTION_REASONS).optional(),
    /** Which identity field moved, when the refusal named one. */
    rejectionField: z.enum(AGENT_EFFECT_REJECTION_FIELDS).optional()
  })
  .strict()
export type AgentPrepareNativeInputResponse = z.infer<
  typeof AgentPrepareNativeInputResponseSchema
>

export interface AgentNativeInputPreparedResult {
  point: { x: number; y: number }
  focused: boolean
  dropPoint?: { x: number; y: number }
}

export const AgentSettleNativeInputRequestSchema = z
  .object({
    version: z.literal(AGENT_CONTROL_VERSION),
    type: z.literal("agent_settle_native_input"),
    runId: z.string().min(1),
    tabId: z.number().int().nonnegative(),
    frameId: z.number().int().nonnegative(),
    nonce: z.string().min(16).max(256),
    sequence: z.number().int().positive(),
    documentId: z.string().min(1)
  })
  .strict()
export type AgentSettleNativeInputRequest = z.infer<
  typeof AgentSettleNativeInputRequestSchema
>

/** Structural only: event types, coordinates and key names, never page text. */
const AgentRecordedInputEventSchema = z
  .object({
    type: z.enum([
      "mousemove",
      "mousedown",
      "mouseup",
      "keydown",
      "keyup",
      "wheel",
      "drop"
    ]),
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    key: z.string().max(40).optional(),
    onTarget: z.boolean()
  })
  .strict()

export const AgentInputTraceSchema = z
  .object({
    events: z.array(AgentRecordedInputEventSchema).max(2_200),
    overflow: z.boolean().optional()
  })
  .strict()

export const AgentSettleNativeInputResponseSchema = z
  .object({
    version: z.literal(AGENT_CONTROL_VERSION),
    type: z.literal("agent_native_input_settled"),
    runId: z.string().min(1),
    tabId: z.number().int().nonnegative(),
    frameId: z.number().int().nonnegative(),
    nonce: z.string().min(16).max(256),
    sequence: z.number().int().positive(),
    documentId: z.string().min(1),
    /** Absent when nothing was armed on this document. */
    trace: AgentInputTraceSchema.optional()
  })
  .strict()
export type AgentSettleNativeInputResponse = z.infer<
  typeof AgentSettleNativeInputResponseSchema
>
export type AgentInputTraceWire = z.infer<typeof AgentInputTraceSchema>

/**
 * Visual grounding asks the page two read-only questions about the snapshot
 * in hand: where everything a screenshot must paint over sits, and what lies
 * under a point, so a pixel the model chose becomes a control the run can
 * reason about. Both are bound to the frame's own snapshot identity like
 * every other request.
 */
export const MAX_AGENT_MASK_REGIONS = 2_000

export const AgentSensitiveRegionsRequestSchema = z
  .object({
    version: z.literal(AGENT_CONTROL_VERSION),
    type: z.literal("agent_sensitive_regions"),
    runId: z.string().min(1),
    tabId: z.number().int().nonnegative(),
    frameId: z.number().int().nonnegative(),
    nonce: z.string().min(16).max(256),
    sequence: z.number().int().positive(),
    documentId: z.string().min(1),
    frame: AgentSnapshotIdentitySchema
  })
  .strict()
export type AgentSensitiveRegionsRequest = z.infer<
  typeof AgentSensitiveRegionsRequestSchema
>

/**
 * Every rect the document says a picture must cover, read from the whole
 * composed tree, with the scroll position they were read at. `null` when the
 * document is not the snapshot the request named.
 */
export const AgentSensitiveRegionsSchema = z
  .object({
    rects: z.array(AgentCssRectSchema).max(MAX_AGENT_MASK_REGIONS),
    scroll: z
      .object({ x: z.number().finite(), y: z.number().finite() })
      .strict()
  })
  .strict()
  .nullable()
export type AgentSensitiveRegions = z.infer<typeof AgentSensitiveRegionsSchema>

export const AgentSensitiveRegionsResponseSchema = z
  .object({
    version: z.literal(AGENT_CONTROL_VERSION),
    type: z.literal("agent_sensitive_regions_measured"),
    runId: z.string().min(1),
    tabId: z.number().int().nonnegative(),
    frameId: z.number().int().nonnegative(),
    nonce: z.string().min(16).max(256),
    sequence: z.number().int().positive(),
    documentId: z.string().min(1),
    regions: AgentSensitiveRegionsSchema
  })
  .strict()
export type AgentSensitiveRegionsResponse = z.infer<
  typeof AgentSensitiveRegionsResponseSchema
>

export const AgentHitTestRequestSchema = z
  .object({
    version: z.literal(AGENT_CONTROL_VERSION),
    type: z.literal("agent_hit_test"),
    runId: z.string().min(1),
    tabId: z.number().int().nonnegative(),
    frameId: z.number().int().nonnegative(),
    nonce: z.string().min(16).max(256),
    sequence: z.number().int().positive(),
    documentId: z.string().min(1),
    frame: AgentSnapshotIdentitySchema,
    point: z.object({ x: z.number().finite(), y: z.number().finite() }).strict()
  })
  .strict()
export type AgentHitTestRequest = z.infer<typeof AgentHitTestRequestSchema>

/**
 * What lies under a point. `element` is the nearest composed ancestor the
 * snapshot knows, or the hit element newly referenced into the snapshot;
 * `frameElement` says the point falls on a child frame, whose controls are
 * that frame's own refs. Nothing under the point is `null`.
 */
export const AgentHitTestResultSchema = z
  .object({
    element: AgentElementSchema.optional(),
    frameElement: z.boolean().optional()
  })
  .strict()
  .nullable()
export type AgentHitTestResult = z.infer<typeof AgentHitTestResultSchema>

export const AgentHitTestResponseSchema = z
  .object({
    version: z.literal(AGENT_CONTROL_VERSION),
    type: z.literal("agent_hit_tested"),
    runId: z.string().min(1),
    tabId: z.number().int().nonnegative(),
    frameId: z.number().int().nonnegative(),
    nonce: z.string().min(16).max(256),
    sequence: z.number().int().positive(),
    documentId: z.string().min(1),
    hit: AgentHitTestResultSchema
  })
  .strict()
export type AgentHitTestResponse = z.infer<typeof AgentHitTestResponseSchema>

export const AgentDiscoverPageToolsRequestSchema = z
  .object({
    version: z.literal(AGENT_CONTROL_VERSION),
    type: z.literal("agent_discover_page_tools"),
    runId: z.string().min(1),
    tabId: z.number().int().nonnegative(),
    frameId: z.number().int().nonnegative(),
    nonce: z.string().min(16).max(256),
    sequence: z.number().int().positive(),
    documentId: z.string().min(1)
  })
  .strict()
export type AgentDiscoverPageToolsRequest = z.infer<
  typeof AgentDiscoverPageToolsRequestSchema
>

export const AgentDiscoverPageToolsResponseSchema = z
  .object({
    version: z.literal(AGENT_CONTROL_VERSION),
    type: z.literal("agent_page_tools_discovered"),
    runId: z.string().min(1),
    tabId: z.number().int().nonnegative(),
    frameId: z.number().int().nonnegative(),
    nonce: z.string().min(16).max(256),
    sequence: z.number().int().positive(),
    documentId: z.string().min(1),
    tools: z.array(AgentPageToolSchema).max(MAX_AGENT_PAGE_TOOLS)
  })
  .strict()
export type AgentDiscoverPageToolsResponse = z.infer<
  typeof AgentDiscoverPageToolsResponseSchema
>

export const AgentExecutePageToolRequestSchema = z
  .object({
    version: z.literal(AGENT_CONTROL_VERSION),
    type: z.literal("agent_execute_page_tool"),
    runId: z.string().min(1),
    tabId: z.number().int().nonnegative(),
    frameId: z.number().int().nonnegative(),
    nonce: z.string().min(16).max(256),
    sequence: z.number().int().positive(),
    documentId: z.string().min(1),
    toolName: z.string().min(1).max(128),
    schemaRevision: z.string().regex(/^[0-9a-f]{8}$/),
    input: AgentPageToolInputSchema
  })
  .strict()
export type AgentExecutePageToolRequest = z.infer<
  typeof AgentExecutePageToolRequestSchema
>

export const AgentExecutePageToolResponseSchema = z
  .object({
    version: z.literal(AGENT_CONTROL_VERSION),
    type: z.enum(["agent_page_tool_executed", "agent_page_tool_stale"]),
    runId: z.string().min(1),
    tabId: z.number().int().nonnegative(),
    frameId: z.number().int().nonnegative(),
    nonce: z.string().min(16).max(256),
    sequence: z.number().int().positive(),
    documentId: z.string().min(1),
    result: z.string().max(1_800).optional(),
    navigation: z.boolean().optional()
  })
  .strict()
export type AgentExecutePageToolResponse = z.infer<
  typeof AgentExecutePageToolResponseSchema
>

const AgentControlRequestSchema = z.union([
  AgentObserveRequestSchema,
  AgentExecuteRequestSchema,
  AgentExecuteScrollRequestSchema,
  AgentExecuteFormFillRequestSchema,
  AgentPrepareNativeInputRequestSchema,
  AgentSettleNativeInputRequestSchema,
  AgentSensitiveRegionsRequestSchema,
  AgentHitTestRequestSchema,
  AgentDiscoverPageToolsRequestSchema,
  AgentExecutePageToolRequestSchema
])
type AgentControlRequest = z.infer<typeof AgentControlRequestSchema>

export interface AgentControlEvent<T extends (...args: never[]) => unknown> {
  addListener(listener: T): void
  removeListener(listener: T): void
}

export interface AgentControlPort {
  readonly name: string
  postMessage(message: unknown): void
  disconnect(): void
  onMessage: AgentControlEvent<(message: unknown) => void>
  onDisconnect: AgentControlEvent<() => void>
}

export interface AgentControlBinding {
  runId: string
  tabId: number
  frameId: number
  nonce: string
  documentId: string
}

export interface AgentControlSenderEvidence {
  tabId: number
  frameId: number
  documentId: string
}

export interface AgentControlObserveOptions {
  minimumGeneration: number
  /** Elements this frame may contribute to a composed observation. */
  elementLimit?: number
  textOffset?: number
  scope?: AgentObservationScope
  lookup?: { queries: readonly string[] }
}

export interface AgentControlSession {
  readonly frameId: number
  /**
   * Named rather than positional. This took four optional positionals and had
   * already produced `observe(generation, signal, undefined, textOffset)` at
   * one call site; a fifth would be a question of counting commas.
   */
  observe(
    request: AgentControlObserveOptions,
    signal?: AbortSignal
  ): Promise<AgentObservation>
  executeDomMutation(
    instruction: AgentDomMutationInstruction,
    signal?: AbortSignal
  ): Promise<string | undefined>
  executeFormFill(
    instruction: AgentFormFillInstruction,
    signal?: AbortSignal
  ): Promise<AgentFormFillOutcome>
  executeScroll(
    instruction: AgentScrollInstruction,
    signal?: AbortSignal
  ): Promise<void>
  prepareNativeInput(
    instruction: AgentDomMutationInstruction,
    signal?: AbortSignal
  ): Promise<AgentNativeInputPreparedResult>
  settleNativeInput(
    signal?: AbortSignal
  ): Promise<AgentInputTraceWire | undefined>
  sensitiveRegions(
    frame: z.infer<typeof AgentSnapshotIdentitySchema>,
    signal?: AbortSignal
  ): Promise<AgentSensitiveRegions>
  hitTest(
    frame: z.infer<typeof AgentSnapshotIdentitySchema>,
    point: { x: number; y: number },
    signal?: AbortSignal
  ): Promise<AgentHitTestResult>
  discoverPageTools?(signal?: AbortSignal): Promise<AgentPageTool[]>
  executePageTool?(
    input: {
      toolName: string
      schemaRevision: string
      args: Record<string, unknown>
    },
    signal?: AbortSignal
  ): Promise<{ result: string; navigation: boolean }>
  disconnect(): void
}

export interface AgentControlBrowserFrame {
  frameId: number
  parentFrameId: number
  documentId?: string
  url: string
}

export interface AgentControlBrowserAdapter {
  getTab(tabId: number): Promise<{ url?: string }>
  getFrame(
    tabId: number,
    frameId: number
  ): Promise<AgentControlBrowserFrame | null>
  /** Every frame the tab currently holds, the root included. */
  listFrames(tabId: number): Promise<AgentControlBrowserFrame[]>
  inject(tabId: number, frameId: number): Promise<void>
  connect(
    tabId: number,
    options: { name: string; frameId: number; documentId: string }
  ): AgentControlPort
  classifyAccess(url?: string): Promise<TabAccess>
  createNonce(): string
}

type BrowserFrameDetails = {
  frameId: number
  parentFrameId?: number
  documentId?: string
  url: string
} | null

const toBrowserFrame = (
  frame: NonNullable<BrowserFrameDetails>
): AgentControlBrowserFrame => ({
  frameId: frame.frameId,
  parentFrameId: frame.parentFrameId ?? -1,
  ...(frame.documentId ? { documentId: frame.documentId } : {}),
  url: frame.url
})

const defaultBrowserAdapter = (): AgentControlBrowserAdapter => ({
  getTab: (tabId) => browser.tabs.get(tabId),
  async getFrame(tabId, frameId) {
    const frame = (await browser.webNavigation.getFrame({
      tabId,
      frameId
    })) as BrowserFrameDetails
    return frame ? toBrowserFrame({ ...frame, frameId }) : null
  },
  async listFrames(tabId) {
    const frames = (await browser.webNavigation.getAllFrames({ tabId })) as
      | NonNullable<BrowserFrameDetails>[]
      | null
    return (frames ?? []).map(toBrowserFrame)
  },
  async inject(tabId, frameId) {
    await browser.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      files: ["content-scripts/agent-control.js"]
    })
  },
  connect(tabId, options) {
    return browser.tabs.connect(tabId, options) as unknown as AgentControlPort
  },
  classifyAccess: classifyAgentTabAccess,
  createNonce: () =>
    `${globalThis.crypto.randomUUID()}${globalThis.crypto.randomUUID()}`
})

const assertBinding = (
  binding: AgentControlBinding,
  sender: AgentControlSenderEvidence
): void => {
  if (
    sender.frameId !== binding.frameId ||
    sender.tabId !== binding.tabId ||
    sender.documentId !== binding.documentId
  ) {
    throw new Error("Agent control port sender binding mismatch")
  }
}

export const validateAgentObservationResponse = (
  raw: unknown,
  binding: AgentControlBinding,
  sequence: number
): AgentObservation => {
  const failure = readAgentControlFailure(raw, binding, sequence)
  if (failure) throw failure
  const response = AgentObserveResponseSchema.parse(raw)
  if (
    response.runId !== binding.runId ||
    response.tabId !== binding.tabId ||
    response.frameId !== binding.frameId ||
    response.nonce !== binding.nonce ||
    response.sequence !== sequence ||
    response.documentId !== binding.documentId ||
    response.observation.tabId !== binding.tabId ||
    response.observation.frameId !== binding.frameId ||
    response.observation.documentId !== binding.documentId ||
    response.observation.frames.length !== 1 ||
    response.observation.elements.some(
      (element) => element.frameId !== binding.frameId
    )
  ) {
    throw new Error("Agent observation response binding mismatch")
  }
  const observedUrl = new URL(response.observation.url)
  if (
    !["http:", "https:"].includes(observedUrl.protocol) ||
    observedUrl.origin !== response.observation.origin
  ) {
    throw new Error("Agent observation response has an invalid origin")
  }
  return response.observation
}

export const validateAgentExecuteResponse = (
  raw: unknown,
  binding: AgentControlBinding,
  sequence: number
): string | undefined => {
  const failure = readAgentControlFailure(raw, binding, sequence)
  if (failure) throw failure
  const response = AgentExecuteResponseSchema.parse(raw)
  if (
    response.runId !== binding.runId ||
    response.tabId !== binding.tabId ||
    response.frameId !== binding.frameId ||
    response.nonce !== binding.nonce ||
    response.sequence !== sequence ||
    response.documentId !== binding.documentId
  ) {
    throw new Error("Agent execution response binding mismatch")
  }
  if (response.type === "agent_dom_mutation_rejected") {
    throw new AgentEffectNotAppliedError(
      agentRejectionMessage(
        response.rejection ?? AGENT_EFFECT_REJECTIONS.unspecified,
        response.rejectionField
      )
    )
  }
  return response.submissionUrl
}

/**
 * A batch answers with how far it got, never by throwing.
 *
 * A rejection that reached here as an exception would take the applied count
 * with it, and the count is the difference between a run that knows three
 * fields are written and one that writes them again. The page still refuses
 * per field; the refusal travels beside the count rather than instead of it.
 */
export const validateAgentFormFillResponse = (
  raw: unknown,
  binding: AgentControlBinding,
  sequence: number
): AgentFormFillOutcome => {
  const failure = readAgentControlFailure(raw, binding, sequence)
  if (failure) throw failure
  const response = AgentFormFillResponseSchema.parse(raw)
  if (
    response.runId !== binding.runId ||
    response.tabId !== binding.tabId ||
    response.frameId !== binding.frameId ||
    response.nonce !== binding.nonce ||
    response.sequence !== sequence ||
    response.documentId !== binding.documentId
  ) {
    throw new Error("Agent form fill response binding mismatch")
  }
  return {
    applied: response.applied,
    ...(response.rejection ? { rejection: response.rejection } : {}),
    ...(response.rejectionField
      ? { rejectionField: response.rejectionField }
      : {})
  }
}

export const validateAgentScrollResponse = (
  raw: unknown,
  binding: AgentControlBinding,
  sequence: number
): void => {
  const failure = readAgentControlFailure(raw, binding, sequence)
  if (failure) throw failure
  const response = AgentScrollResponseSchema.parse(raw)
  if (
    response.runId !== binding.runId ||
    response.tabId !== binding.tabId ||
    response.frameId !== binding.frameId ||
    response.nonce !== binding.nonce ||
    response.sequence !== sequence ||
    response.documentId !== binding.documentId
  ) {
    throw new Error("Agent scroll response binding mismatch")
  }
}

const assertBoundResponse = (
  response: {
    runId: string
    tabId: number
    frameId: number
    nonce: string
    sequence: number
    documentId: string
  },
  binding: AgentControlBinding,
  sequence: number,
  what: string
): void => {
  if (
    response.runId !== binding.runId ||
    response.tabId !== binding.tabId ||
    response.frameId !== binding.frameId ||
    response.nonce !== binding.nonce ||
    response.sequence !== sequence ||
    response.documentId !== binding.documentId
  ) {
    throw new Error(`Agent ${what} response binding mismatch`)
  }
}

export const validateAgentPrepareNativeInputResponse = (
  raw: unknown,
  binding: AgentControlBinding,
  sequence: number
): AgentNativeInputPreparedResult => {
  const failure = readAgentControlFailure(raw, binding, sequence)
  if (failure) throw failure
  const response = AgentPrepareNativeInputResponseSchema.parse(raw)
  assertBoundResponse(response, binding, sequence, "native input preparation")
  if (response.type === "agent_native_input_rejected") {
    throw new AgentEffectNotAppliedError(
      agentRejectionMessage(
        response.rejection ?? AGENT_EFFECT_REJECTIONS.unspecified,
        response.rejectionField
      )
    )
  }
  if (!response.point || response.focused === undefined) {
    throw new Error("Agent native input preparation is incomplete")
  }
  return {
    point: response.point,
    focused: response.focused,
    ...(response.dropPoint ? { dropPoint: response.dropPoint } : {})
  }
}

export const validateAgentSettleNativeInputResponse = (
  raw: unknown,
  binding: AgentControlBinding,
  sequence: number
): AgentInputTraceWire | undefined => {
  const failure = readAgentControlFailure(raw, binding, sequence)
  if (failure) throw failure
  const response = AgentSettleNativeInputResponseSchema.parse(raw)
  assertBoundResponse(response, binding, sequence, "native input settlement")
  return response.trace
}

export const validateAgentSensitiveRegionsResponse = (
  raw: unknown,
  binding: AgentControlBinding,
  sequence: number
): AgentSensitiveRegions => {
  const failure = readAgentControlFailure(raw, binding, sequence)
  if (failure) throw failure
  const response = AgentSensitiveRegionsResponseSchema.parse(raw)
  assertBoundResponse(response, binding, sequence, "sensitive regions")
  return response.regions
}

export const validateAgentHitTestResponse = (
  raw: unknown,
  binding: AgentControlBinding,
  sequence: number
): AgentHitTestResult => {
  const failure = readAgentControlFailure(raw, binding, sequence)
  if (failure) throw failure
  const response = AgentHitTestResponseSchema.parse(raw)
  assertBoundResponse(response, binding, sequence, "hit test")
  if (
    response.hit?.element &&
    response.hit.element.frameId !== binding.frameId
  ) {
    throw new Error("Agent hit test named an element outside its frame")
  }
  return response.hit
}

export const validateAgentDiscoverPageToolsResponse = (
  raw: unknown,
  binding: AgentControlBinding,
  sequence: number
): AgentPageTool[] => {
  const failure = readAgentControlFailure(raw, binding, sequence)
  if (failure) throw failure
  const response = AgentDiscoverPageToolsResponseSchema.parse(raw)
  assertBoundResponse(response, binding, sequence, "page-tool discovery")
  if (
    response.tools.some(
      (tool) =>
        tool.frameId !== binding.frameId ||
        tool.documentId !== binding.documentId
    )
  ) {
    throw new Error("Agent page tool escaped its document binding")
  }
  return response.tools
}

export const validateAgentExecutePageToolResponse = (
  raw: unknown,
  binding: AgentControlBinding,
  sequence: number
): { result: string; navigation: boolean } => {
  const failure = readAgentControlFailure(raw, binding, sequence)
  if (failure) throw failure
  const response = AgentExecutePageToolResponseSchema.parse(raw)
  assertBoundResponse(response, binding, sequence, "page-tool execution")
  if (response.type === "agent_page_tool_stale") {
    throw new AgentEffectNotAppliedError(
      "Page tool changed before it could be called"
    )
  }
  return {
    result: response.result ?? "",
    navigation: response.navigation === true
  }
}

export const createAgentControlSession = (input: {
  port: AgentControlPort
  binding: AgentControlBinding
  sender: AgentControlSenderEvidence
}): AgentControlSession => {
  if (input.port.name !== MESSAGE_KEYS.AGENT.CONTROL_PORT) {
    throw new Error("Unexpected Agent control port")
  }
  assertBinding(input.binding, input.sender)
  let sequence = 0
  let inFlight = false

  const exchange = <T>(
    message: unknown,
    validate: (raw: unknown) => T,
    signal?: AbortSignal
  ): Promise<T> => {
    if (inFlight) {
      return Promise.reject(
        new Error("Agent control request already in flight")
      )
    }
    inFlight = true
    return new Promise<T>((resolve, reject) => {
      const cleanup = () => {
        inFlight = false
        input.port.onMessage.removeListener(onMessage)
        input.port.onDisconnect.removeListener(onDisconnect)
        signal?.removeEventListener("abort", onAbort)
      }
      const fail = (error: Error) => {
        cleanup()
        reject(error)
      }
      const onMessage = (raw: unknown) => {
        try {
          const value = validate(raw)
          cleanup()
          resolve(value)
        } catch (error) {
          input.port.disconnect()
          fail(
            error instanceof Error
              ? error
              : new Error("Invalid Agent control response")
          )
        }
      }
      const onDisconnect = () => fail(new Error("Agent control port closed"))
      const onAbort = () => {
        input.port.disconnect()
        fail(new Error("Agent control request cancelled"))
      }

      input.port.onMessage.addListener(onMessage)
      input.port.onDisconnect.addListener(onDisconnect)
      signal?.addEventListener("abort", onAbort, { once: true })
      if (signal?.aborted) {
        onAbort()
        return
      }
      input.port.postMessage(message)
    })
  }

  return {
    frameId: input.binding.frameId,
    observe(options, signal) {
      const { minimumGeneration, elementLimit, textOffset, scope, lookup } =
        options
      if (inFlight) {
        return Promise.reject(
          new Error("Agent control request already in flight")
        )
      }
      sequence += 1
      const expectedSequence = sequence
      const request: AgentObserveRequest = {
        version: AGENT_CONTROL_VERSION,
        type: "agent_observe",
        ...input.binding,
        sequence: expectedSequence,
        minimumGeneration,
        ...(elementLimit === undefined ? {} : { elementLimit }),
        ...(textOffset === undefined ? {} : { textOffset }),
        ...(scope === undefined ? {} : { scope }),
        ...(lookup === undefined
          ? {}
          : { lookup: { queries: [...lookup.queries] } })
      }

      return exchange(
        request,
        (raw) => {
          const observed = validateAgentObservationResponse(
            raw,
            input.binding,
            expectedSequence
          )
          if (observed.generation < minimumGeneration) {
            throw new Error("Agent observation generation is stale")
          }
          return observed
        },
        signal
      )
    },
    executeDomMutation(instruction, signal) {
      if (inFlight) {
        return Promise.reject(
          new Error("Agent control request already in flight")
        )
      }
      sequence += 1
      const expectedSequence = sequence
      const request: AgentExecuteRequest = {
        version: AGENT_CONTROL_VERSION,
        type: "agent_execute_dom_mutation",
        ...input.binding,
        sequence: expectedSequence,
        instruction: AgentDomMutationInstructionSchema.parse(instruction)
      }
      return exchange(
        request,
        (raw) => {
          return validateAgentExecuteResponse(
            raw,
            input.binding,
            expectedSequence
          )
        },
        signal
      )
    },
    executeFormFill(instruction, signal) {
      if (inFlight) {
        return Promise.reject(
          new Error("Agent control request already in flight")
        )
      }
      sequence += 1
      const expectedSequence = sequence
      const request: AgentExecuteFormFillRequest = {
        version: AGENT_CONTROL_VERSION,
        type: "agent_execute_form_fill",
        ...input.binding,
        sequence: expectedSequence,
        instruction: AgentFormFillInstructionSchema.parse(instruction)
      }
      return exchange(
        request,
        (raw) =>
          validateAgentFormFillResponse(raw, input.binding, expectedSequence),
        signal
      )
    },
    executeScroll(instruction, signal) {
      if (inFlight) {
        return Promise.reject(
          new Error("Agent control request already in flight")
        )
      }
      sequence += 1
      const expectedSequence = sequence
      const request: AgentExecuteScrollRequest = {
        version: AGENT_CONTROL_VERSION,
        type: "agent_execute_scroll",
        ...input.binding,
        sequence: expectedSequence,
        instruction: AgentScrollInstructionSchema.parse(instruction)
      }
      return exchange(
        request,
        (raw) => {
          validateAgentScrollResponse(raw, input.binding, expectedSequence)
        },
        signal
      )
    },
    prepareNativeInput(instruction, signal) {
      if (inFlight) {
        return Promise.reject(
          new Error("Agent control request already in flight")
        )
      }
      sequence += 1
      const expectedSequence = sequence
      const request: AgentPrepareNativeInputRequest = {
        version: AGENT_CONTROL_VERSION,
        type: "agent_prepare_native_input",
        ...input.binding,
        sequence: expectedSequence,
        instruction: AgentDomMutationInstructionSchema.parse(instruction)
      }
      return exchange(
        request,
        (raw) =>
          validateAgentPrepareNativeInputResponse(
            raw,
            input.binding,
            expectedSequence
          ),
        signal
      )
    },
    settleNativeInput(signal) {
      if (inFlight) {
        return Promise.reject(
          new Error("Agent control request already in flight")
        )
      }
      sequence += 1
      const expectedSequence = sequence
      const request: AgentSettleNativeInputRequest = {
        version: AGENT_CONTROL_VERSION,
        type: "agent_settle_native_input",
        ...input.binding,
        sequence: expectedSequence
      }
      return exchange(
        request,
        (raw) =>
          validateAgentSettleNativeInputResponse(
            raw,
            input.binding,
            expectedSequence
          ),
        signal
      )
    },
    sensitiveRegions(frame, signal) {
      if (inFlight) {
        return Promise.reject(
          new Error("Agent control request already in flight")
        )
      }
      sequence += 1
      const expectedSequence = sequence
      const request: AgentSensitiveRegionsRequest = {
        version: AGENT_CONTROL_VERSION,
        type: "agent_sensitive_regions",
        ...input.binding,
        sequence: expectedSequence,
        frame: AgentSnapshotIdentitySchema.parse(frame)
      }
      return exchange(
        request,
        (raw) =>
          validateAgentSensitiveRegionsResponse(
            raw,
            input.binding,
            expectedSequence
          ),
        signal
      )
    },
    hitTest(frame, point, signal) {
      if (inFlight) {
        return Promise.reject(
          new Error("Agent control request already in flight")
        )
      }
      sequence += 1
      const expectedSequence = sequence
      const request: AgentHitTestRequest = {
        version: AGENT_CONTROL_VERSION,
        type: "agent_hit_test",
        ...input.binding,
        sequence: expectedSequence,
        frame: AgentSnapshotIdentitySchema.parse(frame),
        point
      }
      return exchange(
        request,
        (raw) =>
          validateAgentHitTestResponse(raw, input.binding, expectedSequence),
        signal
      )
    },
    ...(AGENT_WEBMCP_COMPILED
      ? {
          discoverPageTools(signal) {
            if (inFlight) {
              return Promise.reject(
                new Error("Agent control request already in flight")
              )
            }
            sequence += 1
            const expectedSequence = sequence
            const request: AgentDiscoverPageToolsRequest = {
              version: AGENT_CONTROL_VERSION,
              type: "agent_discover_page_tools",
              ...input.binding,
              sequence: expectedSequence
            }
            return exchange(
              request,
              (raw) =>
                validateAgentDiscoverPageToolsResponse(
                  raw,
                  input.binding,
                  expectedSequence
                ),
              signal
            )
          },
          executePageTool(tool, signal) {
            if (inFlight) {
              return Promise.reject(
                new Error("Agent control request already in flight")
              )
            }
            sequence += 1
            const expectedSequence = sequence
            const request: AgentExecutePageToolRequest = {
              version: AGENT_CONTROL_VERSION,
              type: "agent_execute_page_tool",
              ...input.binding,
              sequence: expectedSequence,
              toolName: tool.toolName,
              schemaRevision: tool.schemaRevision,
              input: tool.args
            }
            return exchange(
              request,
              (raw) =>
                validateAgentExecutePageToolResponse(
                  raw,
                  input.binding,
                  expectedSequence
                ),
              signal
            )
          }
        }
      : {}),
    disconnect() {
      input.port.disconnect()
    }
  }
}

/**
 * Opens a session on one frame of one tab.
 *
 * The tab is checked first, because a child frame inside a page the run may
 * not read is not readable either, whatever its own address; then the frame's
 * own document, because a frame is its own origin and the tab's answer says
 * nothing about it. A child frame is opened only by a caller that has already
 * decided the run may read it — this function enforces readability, and the
 * caller enforces authorization.
 */
export const openAgentControlSession = async (input: {
  runId: string
  tabId: number
  frameId?: number
  adapter?: AgentControlBrowserAdapter
}): Promise<AgentControlSession> => {
  const adapter = input.adapter ?? defaultBrowserAdapter()
  const frameId = input.frameId ?? 0
  const tab = await adapter.getTab(input.tabId)
  const access = await adapter.classifyAccess(tab.url)
  if (access !== "ok") {
    throw new Error(`Agent tab access denied: ${access}`)
  }
  const frame = await adapter.getFrame(input.tabId, frameId)
  if (!frame || frame.frameId !== frameId || !frame.documentId) {
    throw new Error(
      frameId === 0
        ? "Agent main-frame document is unavailable"
        : "Agent frame document is unavailable"
    )
  }
  if ((await adapter.classifyAccess(frame.url)) !== "ok") {
    throw new Error(
      frameId === 0
        ? "Agent main-frame document is not readable"
        : "Agent frame document is not readable"
    )
  }
  await adapter.inject(input.tabId, frameId)
  const binding: AgentControlBinding = {
    runId: input.runId,
    tabId: input.tabId,
    frameId,
    nonce: adapter.createNonce(),
    documentId: frame.documentId
  }
  const port = adapter.connect(input.tabId, {
    name: MESSAGE_KEYS.AGENT.CONTROL_PORT,
    frameId,
    documentId: frame.documentId
  })
  return createAgentControlSession({
    port,
    binding,
    sender: {
      tabId: input.tabId,
      frameId: frame.frameId,
      documentId: frame.documentId
    }
  })
}

/** Only a typed, pre-effect rejection may authorize re-observation instead of uncertainty. */
const runContentMutation = (
  execute: () => string | undefined
): Pick<
  AgentExecuteResponse,
  "type" | "submissionUrl" | "rejection" | "rejectionField"
> => {
  try {
    return { type: "agent_dom_mutation_executed", submissionUrl: execute() }
  } catch (error) {
    if (error instanceof AgentEffectNotAppliedError) {
      return {
        type: "agent_dom_mutation_rejected",
        rejection: agentRejectionReason(error),
        rejectionField: agentRejectionField(error)
      }
    }
    throw error
  }
}

/**
 * A content port answers one run, one document and one nonce, in sequence.
 * The first request establishes that binding; every later one has to repeat
 * it exactly and advance the sequence by one, or the port closes.
 */
const acceptsControlRequest = (input: {
  binding: AgentControlBinding | undefined
  next: AgentControlBinding
  sequence: number
  lastSequence: number
}): boolean => {
  if (!input.binding) return input.sequence === 1
  return (
    input.binding.runId === input.next.runId &&
    input.binding.tabId === input.next.tabId &&
    input.binding.frameId === input.next.frameId &&
    input.binding.nonce === input.next.nonce &&
    input.binding.documentId === input.next.documentId &&
    input.sequence === input.lastSequence + 1
  )
}

/**
 * An observation that threw and an observation that failed validation are
 * different problems: the first is a page this build cannot read, the second
 * is a snapshot this build produced wrongly. Only the second carries schema
 * evidence, and only the distinction tells a reader which one to go fix.
 */
const controlFailureReason = (
  requestType: AgentControlRequest["type"],
  error: unknown
): AgentControlFailureReason => {
  if (requestType !== "agent_observe") return "execution_failed"
  return error instanceof z.ZodError
    ? "observation_invalid"
    : "observation_build_failed"
}

/** Only a typed, pre-effect rejection may authorize re-observation instead of uncertainty. */
const runContentPreparation = (
  prepare: () => AgentNativeInputPreparedResult
): Pick<
  AgentPrepareNativeInputResponse,
  "type" | "point" | "focused" | "dropPoint" | "rejection" | "rejectionField"
> => {
  try {
    const prepared = prepare()
    return {
      type: "agent_native_input_prepared",
      point: prepared.point,
      focused: prepared.focused,
      ...(prepared.dropPoint ? { dropPoint: prepared.dropPoint } : {})
    }
  } catch (error) {
    if (error instanceof AgentEffectNotAppliedError) {
      return {
        type: "agent_native_input_rejected",
        rejection: agentRejectionReason(error),
        rejectionField: agentRejectionField(error)
      }
    }
    throw error
  }
}

export interface AgentControlContentHandlers {
  buildObservation(request: AgentObserveRequest): AgentObservation
  executeDomMutation(request: AgentExecuteRequest): string | undefined
  executeFormFill(request: AgentExecuteFormFillRequest): AgentFormFillOutcome
  executeScroll(request: AgentExecuteScrollRequest): void
  prepareNativeInput(
    request: AgentPrepareNativeInputRequest
  ): AgentNativeInputPreparedResult
  settleNativeInput(
    request: AgentSettleNativeInputRequest
  ): AgentInputTraceWire | undefined
  sensitiveRegions(request: AgentSensitiveRegionsRequest): AgentSensitiveRegions
  hitTest(request: AgentHitTestRequest): AgentHitTestResult
  discoverPageTools?(
    request: AgentDiscoverPageToolsRequest
  ): Promise<AgentPageTool[]>
  executePageTool?(
    request: AgentExecutePageToolRequest,
    signal: AbortSignal
  ): Promise<
    | { type: "executed"; result: string; navigation: boolean }
    | { type: "stale" }
  >
}

type AgentControlResponse =
  | AgentObserveResponse
  | AgentExecuteResponse
  | AgentFormFillResponse
  | AgentScrollResponse
  | AgentPrepareNativeInputResponse
  | AgentSettleNativeInputResponse
  | AgentSensitiveRegionsResponse
  | AgentHitTestResponse
  | AgentDiscoverPageToolsResponse
  | AgentExecutePageToolResponse
  | AgentControlFailureResponse

const answerAccepted = (
  request: AgentControlRequest,
  binding: AgentControlBinding,
  handlers: AgentControlContentHandlers
): AgentControlResponse => {
  const envelope = {
    version: AGENT_CONTROL_VERSION,
    ...binding,
    sequence: request.sequence
  } as const
  switch (request.type) {
    case "agent_discover_page_tools":
    case "agent_execute_page_tool":
      throw new Error("Page-tool requests use the asynchronous responder")
    case "agent_prepare_native_input":
      return {
        ...envelope,
        ...runContentPreparation(() => handlers.prepareNativeInput(request))
      }
    case "agent_settle_native_input": {
      const trace = handlers.settleNativeInput(request)
      return {
        ...envelope,
        type: "agent_native_input_settled",
        ...(trace ? { trace } : {})
      }
    }
    case "agent_sensitive_regions":
      return {
        ...envelope,
        type: "agent_sensitive_regions_measured",
        regions: handlers.sensitiveRegions(request)
      }
    case "agent_hit_test":
      return {
        ...envelope,
        type: "agent_hit_tested",
        hit: handlers.hitTest(request)
      }
    case "agent_execute_scroll":
      handlers.executeScroll(request)
      return { ...envelope, type: "agent_scroll_executed" }
    case "agent_execute_dom_mutation":
      return {
        ...envelope,
        ...runContentMutation(() => handlers.executeDomMutation(request))
      }
    /**
     * A batch never rejects as a whole: it stops where it stopped and says
     * how far it got. An exception here would discard the count, which is the
     * one fact the run cannot reconstruct — and a run that cannot tell three
     * fields written from none is a run that will write three of them twice.
     */
    case "agent_execute_form_fill": {
      const outcome = handlers.executeFormFill(request)
      return {
        ...envelope,
        type: "agent_form_fill_executed",
        applied: outcome.applied,
        ...(outcome.rejection ? { rejection: outcome.rejection } : {}),
        ...(outcome.rejectionField
          ? { rejectionField: outcome.rejectionField }
          : {})
      }
    }
    case "agent_observe":
      return {
        ...envelope,
        type: "agent_observation",
        observation: AgentObservationSchema.parse(
          handlers.buildObservation(request)
        )
      }
  }
}

const answerPageToolRequest = async (
  request: AgentDiscoverPageToolsRequest | AgentExecutePageToolRequest,
  binding: AgentControlBinding,
  handlers: AgentControlContentHandlers,
  signal: AbortSignal
): Promise<AgentControlResponse> => {
  const envelope = {
    version: AGENT_CONTROL_VERSION,
    ...binding,
    sequence: request.sequence
  } as const
  try {
    if (request.type === "agent_discover_page_tools") {
      return {
        ...envelope,
        type: "agent_page_tools_discovered",
        tools: handlers.discoverPageTools
          ? await handlers.discoverPageTools(request)
          : []
      }
    }
    const outcome = handlers.executePageTool
      ? await handlers.executePageTool(request, signal)
      : { type: "stale" as const }
    return outcome.type === "stale"
      ? { ...envelope, type: "agent_page_tool_stale" }
      : {
          ...envelope,
          type: "agent_page_tool_executed",
          result: outcome.result,
          ...(outcome.navigation ? { navigation: true } : {})
        }
  } catch (error) {
    return {
      ...envelope,
      type: "agent_control_failed",
      reason: "execution_failed",
      issues: agentControlSchemaIssues(error)
    }
  }
}

/**
 * The reply to one accepted request, or the bound failure that stands in for
 * it when the handler threw. Either way the reply carries the request's own
 * binding and sequence, so it can be matched to nothing else.
 */
const answerControlRequest = (
  request: AgentControlRequest,
  binding: AgentControlBinding,
  handlers: AgentControlContentHandlers
): AgentControlResponse => {
  try {
    return answerAccepted(request, binding, handlers)
  } catch (error) {
    return {
      version: AGENT_CONTROL_VERSION,
      type: "agent_control_failed",
      ...binding,
      sequence: request.sequence,
      reason: controlFailureReason(request.type, error),
      issues: agentControlSchemaIssues(error)
    }
  }
}

export const attachAgentControlContentPort = (
  port: AgentControlPort,
  handlers: AgentControlContentHandlers
): boolean => {
  if (port.name !== MESSAGE_KEYS.AGENT.CONTROL_PORT) return false
  let binding: AgentControlBinding | undefined
  let lastSequence = 0
  let activePageTool: AbortController | undefined

  port.onMessage.addListener((raw) => {
    const parsed = AgentControlRequestSchema.safeParse(raw)
    if (!parsed.success) {
      port.disconnect()
      return
    }
    const request = parsed.data
    const nextBinding: AgentControlBinding = {
      runId: request.runId,
      tabId: request.tabId,
      frameId: request.frameId,
      nonce: request.nonce,
      documentId: request.documentId
    }
    if (
      !acceptsControlRequest({
        binding,
        next: nextBinding,
        sequence: request.sequence,
        lastSequence
      })
    ) {
      port.disconnect()
      return
    }

    /*
     * The frame this document is has to be the frame the instruction binds
     * to: same tab, same frame id, same document. The root identity beside it
     * is the command's grounding and is checked where the root was observed.
     */
    const boundFrame =
      request.type === "agent_execute_dom_mutation" ||
      request.type === "agent_execute_scroll" ||
      request.type === "agent_execute_form_fill" ||
      request.type === "agent_prepare_native_input"
        ? request.instruction.frame
        : request.type === "agent_sensitive_regions" ||
            request.type === "agent_hit_test"
          ? request.frame
          : undefined
    if (
      boundFrame &&
      (boundFrame.tabId !== request.tabId ||
        boundFrame.frameId !== request.frameId ||
        boundFrame.documentId !== request.documentId)
    ) {
      port.disconnect()
      return
    }
    if (
      (request.type === "agent_execute_dom_mutation" ||
        request.type === "agent_execute_scroll" ||
        request.type === "agent_execute_form_fill" ||
        request.type === "agent_prepare_native_input") &&
      request.instruction.snapshotIdentity.tabId !== request.tabId
    ) {
      port.disconnect()
      return
    }

    binding = nextBinding
    lastSequence = request.sequence
    if (
      request.type === "agent_discover_page_tools" ||
      request.type === "agent_execute_page_tool"
    ) {
      activePageTool?.abort()
      const controller = new AbortController()
      activePageTool = controller
      void answerPageToolRequest(
        request,
        nextBinding,
        handlers,
        controller.signal
      ).then((response) => {
        if (!controller.signal.aborted) port.postMessage(response)
        if (activePageTool === controller) activePageTool = undefined
      })
      return
    }
    port.postMessage(answerControlRequest(request, nextBinding, handlers))
  })
  port.onDisconnect.addListener(() => activePageTool?.abort())
  return true
}
