import { processFile } from "@/lib/file-processors"
import { isTrustedPersistenceSender } from "@/lib/persistence/host-authorization"
import { ingestionPayloadDb } from "./ingestion-payload-db"
import {
  INGESTION_PROCESS_REQUEST,
  type IngestionProcessResponse
} from "./ingestion-processor-protocol"

let registered = false

export const processStagedIngestionPayload = async (
  jobId: string
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
  const parsedFile = await processFile(file)
  await ingestionPayloadDb.payloads.put({
    ...payload,
    kind: "processed",
    processedFile: {
      ...parsedFile,
      metadata: {
        ...parsedFile.metadata,
        fileId: payload.fileId,
        knowledgeSetId: payload.knowledgeSetId
      }
    }
  })
}

export const registerIngestionProcessorHost = (): void => {
  if (registered) return
  registered = true
  const extensionUrlPrefix = chrome.runtime.getURL("")
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const request = message as { type?: string; jobId?: unknown } | undefined
    if (
      request?.type !== INGESTION_PROCESS_REQUEST ||
      typeof request.jobId !== "string" ||
      !isTrustedPersistenceSender(sender, chrome.runtime.id, extensionUrlPrefix)
    ) {
      return false
    }

    void processStagedIngestionPayload(request.jobId)
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
