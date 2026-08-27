import { logger } from "@/lib/logger"
import { toAppFailure } from "@/protocol/app-failure"
import {
  MODEL_PULL_EVENT_TYPES,
  type ModelPullServerEvent,
  STREAM_PROTOCOL_VERSION
} from "@/protocol/streams"
import type { DefaultProviderPullResponse } from "@/types"

interface PullStreamOptions {
  isCancelled: () => boolean
  onEvent: (event: ModelPullServerEvent) => void | Promise<void>
}

const eventFromResponse = (
  data: DefaultProviderPullResponse
): ModelPullServerEvent[] => {
  const events: ModelPullServerEvent[] = []
  if (data.status) {
    events.push({
      version: STREAM_PROTOCOL_VERSION,
      type: MODEL_PULL_EVENT_TYPES.PROGRESS,
      status: data.status
    })
    if (data.status === "success") {
      events.push({
        version: STREAM_PROTOCOL_VERSION,
        type: MODEL_PULL_EVENT_TYPES.COMPLETE,
        status: data.status
      })
      return events
    }
  }
  if (data.error) {
    events.push({
      version: STREAM_PROTOCOL_VERSION,
      type: MODEL_PULL_EVENT_TYPES.ERROR,
      failure: toAppFailure(data.error)
    })
    return events
  }
  if (data.completed !== undefined && data.total !== undefined) {
    const progress = Math.round((data.completed / data.total) * 100)
    events.push({
      version: STREAM_PROTOCOL_VERSION,
      type: MODEL_PULL_EVENT_TYPES.PROGRESS,
      status: `Downloading: ${progress}%`,
      progress
    })
  }
  return events
}

const isTerminalEvent = (event: ModelPullServerEvent): boolean =>
  event.type === MODEL_PULL_EVENT_TYPES.COMPLETE ||
  event.type === MODEL_PULL_EVENT_TYPES.ERROR

const emitResponseEvents = async (
  data: DefaultProviderPullResponse,
  onEvent: PullStreamOptions["onEvent"]
): Promise<boolean> => {
  for (const event of eventFromResponse(data)) {
    await onEvent(event)
    if (isTerminalEvent(event)) return true
  }
  return false
}

const consumeJsonLine = async (
  line: string,
  options: PullStreamOptions,
  context: "line" | "final buffer"
): Promise<boolean> => {
  const trimmed = line.trim()
  if (!trimmed) return false

  try {
    const data: DefaultProviderPullResponse = JSON.parse(trimmed)
    return await emitResponseEvents(data, options.onEvent)
  } catch (parseError) {
    logger.warn(`Failed to parse ${context}`, "handlePullStream", {
      ...(context === "line" ? { line: trimmed } : { buffer: line }),
      error: parseError
    })
    return false
  }
}

const cancelReader = async (
  reader: ReadableStreamDefaultReader<Uint8Array>
): Promise<void> => {
  await reader.cancel().catch((error) => {
    logger.error("Failed to cancel reader", "handlePullStream", { error })
  })
}

export const consumePullStream = async (
  res: Response,
  options: PullStreamOptions
): Promise<void> => {
  if (!res.body) return

  const reader = res.body.getReader()
  const decoder = new TextDecoder("utf-8")
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    if (options.isCancelled()) {
      await cancelReader(reader)
      break
    }

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() || ""

    for (const line of lines) {
      if (await consumeJsonLine(line, options, "line")) return
    }
  }

  if (!options.isCancelled()) {
    await consumeJsonLine(buffer, options, "final buffer")
  }
}
