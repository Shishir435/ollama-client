import { createErrorResponse } from "@/background/lib/error-handler"
import { generateEmbeddingsBatch } from "@/lib/embeddings/embedding-client"
import { storeVector } from "@/lib/embeddings/storage"
import { logger } from "@/lib/logger"
import type { ChromeMessage, ChromePort, ChromeResponse } from "@/types"

export interface EmbedChunksPayload {
  chunks: { index: number; text: string }[]
  metadata: {
    fileId: string
    title?: string
    timestamp?: number
  }
  model?: string
}

/**
 * Fallback handler for older clients that use direct message passing
 * instead of port-based streaming
 */
export const handleEmbedFileChunks = async (
  message: ChromeMessage,
  sendResponse: (resp: ChromeResponse) => void
) => {
  // Fall back to simple implementation: call port-based handler with an emulated port
  const payload = message.payload as EmbedChunksPayload
  if (!payload || !Array.isArray(payload.chunks)) {
    try {
      sendResponse({
        success: false,
        error: { status: 0, message: "Invalid payload" }
      })
    } catch (e) {
      logger.warn(
        "Port closed before error response sent",
        "handleEmbedFileChunks",
        { error: e }
      )
    }
    return
  }

  // Process in background without streaming progress
  try {
    const texts = payload.chunks.map((c) => c.text)
    const results = await generateEmbeddingsBatch(texts, payload.model)

    // Store embeddings
    for (let i = 0; i < results.length; i++) {
      const res = results[i]
      const chunk = payload.chunks[i]
      if ("embedding" in res && res.embedding) {
        try {
          await storeVector(chunk.text, res.embedding, {
            type: "file",
            fileId: payload.metadata.fileId,
            title: payload.metadata.title,
            source: payload.metadata.title || payload.metadata.fileId,
            timestamp: payload.metadata.timestamp || Date.now(),
            chunkIndex: chunk.index,
            totalChunks: payload.chunks.length,
            embeddingModel: "model" in res ? res.model : undefined,
            embeddingDim: res.embedding.length
          })
        } catch (e) {
          logger.warn(
            "Failed to store vector for chunk",
            "handleEmbedFileChunks",
            { chunkIndex: chunk.index, error: e }
          )
        }
      }
    }

    try {
      sendResponse({
        success: true,
        data: { embedded: results.length }
      })
    } catch (e) {
      logger.warn(
        "Port closed before success response sent",
        "handleEmbedFileChunks",
        { error: e }
      )
    }
  } catch (error) {
    try {
      sendResponse(createErrorResponse(error, { status: 500 }))
    } catch (e) {
      logger.warn(
        "Port closed before error response sent",
        "handleEmbedFileChunks",
        { error: e }
      )
    }
  }
}

/**
 * Port-based handler for file chunk embeddings with progress updates
 * Supports streaming large batches efficiently
 */
export const handleEmbedFileChunksPort = (port: ChromePort) => {
  let metadata: EmbedChunksPayload["metadata"] | null = null
  let modelName: string | undefined
  let totalChunks = 0
  let processed = 0
  let cancelled = false
  let closed = false

  const postMessage = (message: Record<string, unknown>) => {
    if (closed) return false
    try {
      port.postMessage(message as unknown as ChromeMessage)
      return true
    } catch (e) {
      logger.warn(
        "Port disconnected during postMessage",
        "handleEmbedFileChunksPort",
        { error: e }
      )
      cancelled = true
      closed = true
      return false
    }
  }

  const closePort = () => {
    if (closed) return
    closed = true
    try {
      port.disconnect()
    } catch (e) {
      logger.warn(
        "Port already closed during disconnect",
        "handleEmbedFileChunksPort",
        { error: e }
      )
    }
  }

  port.onMessage.addListener(async (message) => {
    if (closed) return
    const msg = message as ChromeMessage
    try {
      if (msg.cancel) {
        cancelled = true
        postMessage({
          status: "cancelled",
          processed,
          total: totalChunks
        })
        closePort()
        return
      }

      if (msg.type === "init") {
        const payload = msg.payload as {
          metadata: EmbedChunksPayload["metadata"]
          model?: string
        }
        metadata = payload.metadata
        modelName = payload.model
        totalChunks = 0
        processed = 0
        cancelled = false

        postMessage({ status: "initialized" })
        return
      }

      if (msg.type === "batch") {
        if (!metadata) {
          postMessage({
            status: "error",
            message: "Embedding stream was not initialized",
            processed,
            total: totalChunks
          })
          closePort()
          return
        }

        const batch = (
          msg.payload as { chunks: { index: number; text: string }[] }
        ).chunks
        if (!batch || batch.length === 0) return

        totalChunks += batch.length

        // Generate embeddings for this batch
        const texts = batch.map((c) => c.text)
        const results = await generateEmbeddingsBatch(texts, modelName)

        // Store each embedding
        for (let i = 0; i < results.length; i++) {
          if (cancelled) break
          const res = results[i]
          const chunk = batch[i]

          // Type guard: check if this is an EmbeddingResult (not an error)
          if ("embedding" in res && res.embedding) {
            try {
              await storeVector(chunk.text, res.embedding, {
                type: "file",
                fileId: metadata?.fileId || "",
                title: metadata?.title,
                source: metadata?.title || metadata?.fileId || "Unknown File",
                timestamp: metadata?.timestamp || Date.now(),
                chunkIndex: chunk.index,
                totalChunks: totalChunks,
                embeddingModel: "model" in res ? res.model : undefined,
                embeddingDim: res.embedding.length
              })
            } catch (e) {
              logger.warn(
                "Failed to store vector for chunk",
                "handleEmbedFileChunksPort",
                { chunkIndex: chunk.index, error: e }
              )
            }
          }
          processed++
        }

        // Send progress update
        postMessage({
          status: "progress",
          processed,
          total: totalChunks
        })
        return
      }

      if (msg.type === "done") {
        postMessage({ status: "done", processed, total: totalChunks })
        closePort()
        return
      }
    } catch (err) {
      const eMsg = err instanceof Error ? err.message : String(err)
      postMessage({
        status: "error",
        message: eMsg,
        processed,
        total: totalChunks
      })
      closePort()
    }
  })

  port.onDisconnect.addListener(() => {
    cancelled = true
    closed = true
  })
}
