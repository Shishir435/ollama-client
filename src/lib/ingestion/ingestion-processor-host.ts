import { processFile } from "@/lib/file-processors"
import { isTrustedPersistenceSender } from "@/lib/persistence/host-authorization"
import { toDurableProcessedFile } from "./durable-processed-file"
import { ingestionPayloadDb } from "./ingestion-payload-db"
import {
  INGESTION_CANCEL_REQUEST,
  INGESTION_PROCESS_REQUEST,
  type IngestionProcessResponse
} from "./ingestion-processor-protocol"

let registered = false

/**
 * Parses in flight per job, so a cancel reaches every one of them. A restarted
 * worker can request a job that is still being parsed, and each attempt owns
 * its own controller: a cancel aborts all, and a finishing attempt removes only
 * its own.
 */
const inFlight = new Map<string, Set<AbortController>>()

const track = (jobId: string, controller: AbortController): (() => void) => {
  const attempts = inFlight.get(jobId) ?? new Set<AbortController>()
  attempts.add(controller)
  inFlight.set(jobId, attempts)
  return () => {
    attempts.delete(controller)
    if (attempts.size === 0 && inFlight.get(jobId) === attempts) {
      inFlight.delete(jobId)
    }
  }
}

export const processStagedIngestionPayload = async (
  jobId: string,
  signal?: AbortSignal
): Promise<void> => {
  const payload = await ingestionPayloadDb.payloads.get(jobId)
  if (!payload) {
    throw new Error("The durable ingestion payload is missing")
  }
  if (payload.kind === "processed") return

  const file = new File([payload.bytes], payload.fileName, {
    type: payload.contentType,
    lastModified: payload.lastModified
  })
  const parsedFile = await processFile(file, signal)
  signal?.throwIfAborted()
  await ingestionPayloadDb.payloads.put({
    jobId: payload.jobId,
    fileId: payload.fileId,
    knowledgeSetId: payload.knowledgeSetId,
    fileName: payload.fileName,
    contentType: payload.contentType,
    autoEmbed: payload.autoEmbed,
    createdAt: payload.createdAt,
    kind: "processed",
    processedFile: toDurableProcessedFile(parsedFile, {
      fileId: payload.fileId,
      knowledgeSetId: payload.knowledgeSetId
    })
  })
}

export const registerIngestionProcessorHost = (): void => {
  if (registered) return
  registered = true
  const extensionUrlPrefix = chrome.runtime.getURL("")
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const request = message as { type?: string; jobId?: unknown } | undefined
    if (
      request?.type === INGESTION_CANCEL_REQUEST &&
      typeof request.jobId === "string" &&
      isTrustedPersistenceSender(sender, chrome.runtime.id, extensionUrlPrefix)
    ) {
      for (const controller of inFlight.get(request.jobId) ?? []) {
        controller.abort()
      }
      return false
    }
    if (
      request?.type !== INGESTION_PROCESS_REQUEST ||
      typeof request.jobId !== "string" ||
      !isTrustedPersistenceSender(sender, chrome.runtime.id, extensionUrlPrefix)
    ) {
      return false
    }

    const { jobId } = request
    const controller = new AbortController()
    const untrack = track(jobId, controller)
    void processStagedIngestionPayload(jobId, controller.signal)
      .finally(untrack)
      .then(() => {
        sendResponse({ ok: true } satisfies IngestionProcessResponse)
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        } satisfies IngestionProcessResponse)
      })
    return true
  })
}
