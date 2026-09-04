import {
  AgentCommandSchema,
  type AgentObservation,
  AgentObservationSchema,
  AgentSnapshotIdentitySchema
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
    frameId: z.literal(0),
    nonce: z.string().min(16).max(256),
    sequence: z.number().int().positive(),
    documentId: z.string().min(1),
    minimumGeneration: z.number().int().nonnegative()
  })
  .strict()
export type AgentObserveRequest = z.infer<typeof AgentObserveRequestSchema>

export const AgentObserveResponseSchema = z
  .object({
    version: z.literal(AGENT_CONTROL_VERSION),
    type: z.literal("agent_observation"),
    runId: z.string().min(1),
    tabId: z.number().int().nonnegative(),
    frameId: z.literal(0),
    nonce: z.string().min(16).max(256),
    sequence: z.number().int().positive(),
    documentId: z.string().min(1),
    observation: AgentObservationSchema
  })
  .strict()
export type AgentObserveResponse = z.infer<typeof AgentObserveResponseSchema>

const AgentDomMutationTargetSchema = z
  .object({
    ref: z.string().min(1),
    frameId: z.literal(0),
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

export const AgentDomMutationInstructionSchema = z
  .object({
    command: AgentDomMutationCommandSchema,
    target: AgentDomMutationTargetSchema,
    snapshotIdentity: AgentSnapshotIdentitySchema
  })
  .strict()
  .superRefine((instruction, context) => {
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
    frameId: z.literal(0),
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
    type: z.literal("agent_dom_mutation_executed"),
    runId: z.string().min(1),
    tabId: z.number().int().nonnegative(),
    frameId: z.literal(0),
    nonce: z.string().min(16).max(256),
    sequence: z.number().int().positive(),
    documentId: z.string().min(1)
  })
  .strict()
export type AgentExecuteResponse = z.infer<typeof AgentExecuteResponseSchema>

const AgentControlRequestSchema = z.union([
  AgentObserveRequestSchema,
  AgentExecuteRequestSchema
])

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
  frameId: 0
  nonce: string
  documentId: string
}

export interface AgentControlSenderEvidence {
  tabId: number
  frameId: number
  documentId: string
}

export interface AgentControlSession {
  observe(
    minimumGeneration: number,
    signal?: AbortSignal
  ): Promise<AgentObservation>
  executeDomMutation(
    instruction: AgentDomMutationInstruction,
    signal?: AbortSignal
  ): Promise<void>
  disconnect(): void
}

export interface AgentControlBrowserAdapter {
  getTab(tabId: number): Promise<{ url?: string }>
  getMainFrame(tabId: number): Promise<{
    frameId: number
    documentId?: string
    url: string
  } | null>
  inject(tabId: number): Promise<void>
  connect(
    tabId: number,
    options: { name: string; frameId: 0; documentId: string }
  ): AgentControlPort
  classifyAccess(url?: string): Promise<TabAccess>
  createNonce(): string
}

const defaultBrowserAdapter = (): AgentControlBrowserAdapter => ({
  getTab: (tabId) => browser.tabs.get(tabId),
  async getMainFrame(tabId) {
    const frame = await browser.webNavigation.getFrame({ tabId, frameId: 0 })
    return frame ? { ...frame, frameId: 0 } : null
  },
  async inject(tabId) {
    await browser.scripting.executeScript({
      target: { tabId, frameIds: [0] },
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
    binding.frameId !== 0 ||
    sender.frameId !== 0 ||
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
  const response = AgentObserveResponseSchema.parse(raw)
  if (
    response.runId !== binding.runId ||
    response.tabId !== binding.tabId ||
    response.frameId !== binding.frameId ||
    response.nonce !== binding.nonce ||
    response.sequence !== sequence ||
    response.documentId !== binding.documentId ||
    response.observation.tabId !== binding.tabId ||
    response.observation.documentId !== binding.documentId ||
    response.observation.elements.some((element) => element.frameId !== 0)
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
): void => {
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
    observe(minimumGeneration, signal) {
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
        minimumGeneration
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
          validateAgentExecuteResponse(raw, input.binding, expectedSequence)
        },
        signal
      )
    },
    disconnect() {
      input.port.disconnect()
    }
  }
}

export const openAgentControlSession = async (input: {
  runId: string
  tabId: number
  adapter?: AgentControlBrowserAdapter
}): Promise<AgentControlSession> => {
  const adapter = input.adapter ?? defaultBrowserAdapter()
  const tab = await adapter.getTab(input.tabId)
  const access = await adapter.classifyAccess(tab.url)
  if (access !== "ok") {
    throw new Error(`Agent tab access denied: ${access}`)
  }
  const frame = await adapter.getMainFrame(input.tabId)
  if (!frame || frame.frameId !== 0 || !frame.documentId) {
    throw new Error("Agent main-frame document is unavailable")
  }
  if ((await adapter.classifyAccess(frame.url)) !== "ok") {
    throw new Error("Agent main-frame document is not readable")
  }
  await adapter.inject(input.tabId)
  const binding: AgentControlBinding = {
    runId: input.runId,
    tabId: input.tabId,
    frameId: 0,
    nonce: adapter.createNonce(),
    documentId: frame.documentId
  }
  const port = adapter.connect(input.tabId, {
    name: MESSAGE_KEYS.AGENT.CONTROL_PORT,
    frameId: 0,
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

export const attachAgentControlContentPort = (
  port: AgentControlPort,
  handlers: {
    buildObservation(request: AgentObserveRequest): AgentObservation
    executeDomMutation(request: AgentExecuteRequest): void
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
    if (binding) {
      const matches =
        binding.runId === nextBinding.runId &&
        binding.tabId === nextBinding.tabId &&
        binding.frameId === nextBinding.frameId &&
        binding.nonce === nextBinding.nonce &&
        binding.documentId === nextBinding.documentId
      if (!matches || request.sequence !== lastSequence + 1) {
        port.disconnect()
        return
      }
    } else if (request.sequence !== 1) {
      port.disconnect()
      return
    }

    try {
      if (request.type === "agent_execute_dom_mutation") {
        const identity = request.instruction.snapshotIdentity
        if (
          identity.tabId !== request.tabId ||
          identity.documentId !== request.documentId
        ) {
          throw new Error("Agent mutation instruction binding mismatch")
        }
        handlers.executeDomMutation(request)
        binding = nextBinding
        lastSequence = request.sequence
        const response: AgentExecuteResponse = {
          version: AGENT_CONTROL_VERSION,
          type: "agent_dom_mutation_executed",
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
    } catch {
      port.disconnect()
    }
  })
  return true
}
