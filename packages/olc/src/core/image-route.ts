/** OpenAI-compatible image generations over a runtime-native image backend. */
import {
  type AgentBackend,
  BackendInputError,
  type GeneratedImage
} from "../backends/types.js"
import type {
  ImageGenerationRequest,
  ProxyConfig,
  ProxyLogger
} from "../types.js"
import { isRecord } from "../util.js"
import { type Router, sendJson } from "./http.js"
import { OLC_PUBLIC_ROUTES } from "./public-api-contract.js"
import { QueueStalledError, type RequestQueue } from "./queue.js"

const MAX_PROMPT_CHARS = 100_000
const MAX_IMAGE_BASE64_CHARS = 50 * 1024 * 1024
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

const badRequest = (message: string) => ({
  error: { message, type: "BadRequest" }
})

const normalizeImage = (image: GeneratedImage): GeneratedImage | null => {
  const dataUrl = /^data:image\/[A-Za-z0-9.+-]+;base64,(.*)$/s.exec(
    image.b64Json.trim()
  )
  const b64Json = (dataUrl?.[1] ?? image.b64Json).replace(/\s/g, "")
  if (
    !b64Json ||
    b64Json.length > MAX_IMAGE_BASE64_CHARS ||
    b64Json.length % 4 !== 0 ||
    !BASE64.test(b64Json)
  ) {
    return null
  }
  return {
    b64Json,
    ...(image.revisedPrompt ? { revisedPrompt: image.revisedPrompt } : {})
  }
}

export const registerImageRoutes = (
  router: Router,
  {
    backend,
    config,
    lock,
    log = () => {}
  }: {
    backend: AgentBackend
    config: ProxyConfig
    lock: RequestQueue
    log?: ProxyLogger
  }
): void => {
  router.post(OLC_PUBLIC_ROUTES.imageGenerations, async (request, response) => {
    const body: ImageGenerationRequest = isRecord(request.body)
      ? request.body
      : {}
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : ""
    if (!prompt) {
      sendJson(response, 400, badRequest("prompt is required"))
      return
    }
    if (prompt.length > MAX_PROMPT_CHARS) {
      sendJson(
        response,
        400,
        badRequest(`prompt must be at most ${MAX_PROMPT_CHARS} characters`)
      )
      return
    }
    if (body.n !== undefined && body.n !== 1) {
      sendJson(response, 400, badRequest("only n=1 is supported"))
      return
    }
    if (
      body.response_format !== undefined &&
      body.response_format !== "b64_json"
    ) {
      sendJson(
        response,
        400,
        badRequest("only response_format='b64_json' is supported")
      )
      return
    }
    if (!backend.generateImage) {
      sendJson(response, 501, {
        error: {
          message: `Backend '${backend.id}' does not support image generation`,
          type: "UnsupportedOperation"
        }
      })
      return
    }
    const generateImage = backend.generateImage

    const target = await backend.resolveModel(body.model)
    if ("error" in target) {
      sendJson(response, 400, badRequest(target.error))
      return
    }

    const abortController = new AbortController()
    request.raw.once("aborted", () => abortController.abort())
    response.once("close", () => {
      if (!response.writableEnded) abortController.abort()
    })

    try {
      const images = (
        await lock(
          async (queueSignal) => {
            const abortFromQueue = () =>
              abortController.abort(queueSignal.reason)
            queueSignal.addEventListener("abort", abortFromQueue, {
              once: true
            })
            try {
              await backend.ensureReady()
              return await generateImage({
                requestId: `img_${Date.now().toString(36)}`,
                model: target,
                prompt,
                signal: abortController.signal
              })
            } finally {
              queueSignal.removeEventListener("abort", abortFromQueue)
            }
          },
          config.REQUEST_TIMEOUT_MS + 60_000,
          `image-generation:${target.providerId}/${target.modelId}`
        )
      )
        .map(normalizeImage)
        .filter((image): image is GeneratedImage => image !== null)

      if (images.length === 0) {
        throw new Error("The backend completed without returning image data")
      }
      log("POST /v1/images/generations ok", {
        model: `${target.providerId}/${target.modelId}`,
        count: images.length
      })
      sendJson(response, 200, {
        created: Math.floor(Date.now() / 1000),
        data: images.map((image) => ({
          b64_json: image.b64Json,
          ...(image.revisedPrompt
            ? { revised_prompt: image.revisedPrompt }
            : {})
        }))
      })
    } catch (error) {
      const message = (error as Error).message
      const inputError = error instanceof BackendInputError
      const stalled = error instanceof QueueStalledError
      const aborted = abortController.signal.aborted
      const timedOut = aborted && /Request timeout/.test(message)
      if (aborted && response.writableEnded) return
      sendJson(
        response,
        stalled
          ? 503
          : aborted
            ? timedOut
              ? 504
              : 499
            : inputError
              ? 400
              : 502,
        {
          error: {
            message: timedOut
              ? "Image generation timed out"
              : aborted
                ? "Image generation was cancelled"
                : message,
            type: stalled
              ? "ServiceUnavailable"
              : timedOut
                ? "Timeout"
                : aborted
                  ? "Cancelled"
                  : inputError
                    ? "BadRequest"
                    : "ImageGenerationError"
          }
        }
      )
    }
  })
}
