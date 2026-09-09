import {
  AGENT_CONTROL_FAILURE_REASONS,
  AgentControlFailedError,
  type AgentControlFailureReason,
  AgentEffectNotAppliedError,
  type AgentSchemaIssue
} from "@ollama-client/agent-runtime"
import {
  AgentCommandSchema,
  type AgentObservation,
  AgentObservationSchema,
  AgentSnapshotIdentitySchema,
  MAX_AGENT_OBSERVED_ELEMENTS
} from "@ollama-client/contracts"
import { z } from "zod"

import { browser } from "@/lib/browser-api"
import {
  classifyAgentTabAccess,
  type TabAccess
} from "@/lib/browser-tab-access"
import { MESSAGE_KEYS } from "@/lib/constants"

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
    observedValue: z.string().max(500).optional(),
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
    expectedValue: z.string().max(500).optional(),
    expectedChecked: z.boolean().optional(),
    sensitive: z.boolean(),
    maySubmit: z.boolean()
  })
  .strict()

const AgentDomMutationCommandSchema = AgentCommandSchema.refine(
  (command) =>
    [
      "click",
      "type",
      "clear_and_type",
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
    frame: AgentSnapshotIdentitySchema
  })
  .strict()
  .superRefine(assertFrameBinding)
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
    submissionUrl: z.url().max(32_768).optional()
  })
  .strict()
export type AgentExecuteResponse = z.infer<typeof AgentExecuteResponseSchema>

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

const AgentControlRequestSchema = z.union([
  AgentObserveRequestSchema,
  AgentExecuteRequestSchema,
  AgentExecuteScrollRequestSchema
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

export interface AgentControlSession {
  readonly frameId: number
  observe(
    minimumGeneration: number,
    signal?: AbortSignal,
    elementLimit?: number
  ): Promise<AgentObservation>
  executeDomMutation(
    instruction: AgentDomMutationInstruction,
    signal?: AbortSignal
  ): Promise<string | undefined>
  executeScroll(
    instruction: AgentScrollInstruction,
    signal?: AbortSignal
  ): Promise<void>
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
  if (response.type === "agent_dom_mutation_rejected")
    throw new AgentEffectNotAppliedError()
  return response.submissionUrl
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
    observe(minimumGeneration, signal, elementLimit) {
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
        ...(elementLimit === undefined ? {} : { elementLimit })
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
): Pick<AgentExecuteResponse, "type" | "submissionUrl"> => {
  try {
    return { type: "agent_dom_mutation_executed", submissionUrl: execute() }
  } catch (error) {
    if (error instanceof AgentEffectNotAppliedError)
      return { type: "agent_dom_mutation_rejected" }
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

export const attachAgentControlContentPort = (
  port: AgentControlPort,
  handlers: {
    buildObservation(request: AgentObserveRequest): AgentObservation
    executeDomMutation(request: AgentExecuteRequest): string | undefined
    executeScroll(request: AgentExecuteScrollRequest): void
  }
): boolean => {
  if (port.name !== MESSAGE_KEYS.AGENT.CONTROL_PORT) return false
  let binding: AgentControlBinding | undefined
  let lastSequence = 0

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
    if (
      (request.type === "agent_execute_dom_mutation" ||
        request.type === "agent_execute_scroll") &&
      (request.instruction.frame.tabId !== request.tabId ||
        request.instruction.frame.frameId !== request.frameId ||
        request.instruction.frame.documentId !== request.documentId ||
        request.instruction.snapshotIdentity.tabId !== request.tabId)
    ) {
      port.disconnect()
      return
    }

    try {
      if (
        request.type === "agent_execute_dom_mutation" ||
        request.type === "agent_execute_scroll"
      ) {
        let mutation: Pick<AgentExecuteResponse, "type" | "submissionUrl"> = {
          type: "agent_dom_mutation_executed"
        }
        if (request.type === "agent_execute_scroll") {
          handlers.executeScroll(request)
        } else {
          mutation = runContentMutation(() =>
            handlers.executeDomMutation(request)
          )
        }
        binding = nextBinding
        lastSequence = request.sequence
        const response: AgentExecuteResponse | AgentScrollResponse =
          request.type === "agent_execute_scroll"
            ? {
                version: AGENT_CONTROL_VERSION,
                type: "agent_scroll_executed",
                ...nextBinding,
                sequence: request.sequence
              }
            : {
                version: AGENT_CONTROL_VERSION,
                ...mutation,
                ...nextBinding,
                sequence: request.sequence
              }
        port.postMessage(response)
        return
      }
      const observation = AgentObservationSchema.parse(
        handlers.buildObservation(request)
      )
      binding = nextBinding
      lastSequence = request.sequence
      const response: AgentObserveResponse = {
        version: AGENT_CONTROL_VERSION,
        type: "agent_observation",
        ...nextBinding,
        sequence: request.sequence,
        observation
      }
      port.postMessage(response)
    } catch (error) {
      binding = nextBinding
      lastSequence = request.sequence
      const failure: AgentControlFailureResponse = {
        version: AGENT_CONTROL_VERSION,
        type: "agent_control_failed",
        ...nextBinding,
        sequence: request.sequence,
        reason: controlFailureReason(request.type, error),
        issues: agentControlSchemaIssues(error)
      }
      port.postMessage(failure)
    }
  })
  return true
}
