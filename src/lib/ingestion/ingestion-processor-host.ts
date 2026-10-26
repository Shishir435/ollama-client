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

/** Parses in flight, so a cancel from the service can reach the one it names. */
const inFlight = new Map<string, AbortController>()

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
      inFlight.get(request.jobId)?.abort()
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
    inFlight.set(jobId, controller)
    void processStagedIngestionPayload(jobId, controller.signal)
      .finally(() => inFlight.delete(jobId))
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
