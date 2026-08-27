/** OpenAI-compatible image generations over a runtime-native image backend. */
import type { ServerResponse } from "node:http"
import {
  type AgentBackend,
  BackendInputError,
  type GeneratedImage,
  type ResolvedModel
} from "../backends/types.js"
import type {
  ImageGenerationRequest,
  ProxyConfig,
  ProxyLogger
} from "../types.js"
import { isRecord } from "../util.js"
import { type RouteRequest, type Router, sendJson } from "./http.js"
import { OLC_PUBLIC_ROUTES } from "./public-api-contract.js"
import { QueueStalledError, type RequestQueue } from "./queue.js"

const MAX_PROMPT_CHARS = 100_000
const MAX_IMAGE_BASE64_CHARS = 50 * 1024 * 1024
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

type ResolvedModelTarget = Exclude<ResolvedModel, { error: string }>

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

const parseImageRequest = (
  rawBody: unknown
): { body: ImageGenerationRequest; prompt: string; error?: string } => {
  const body: ImageGenerationRequest = isRecord(rawBody) ? rawBody : {}
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : ""
  if (!prompt) return { body, prompt, error: "prompt is required" }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return {
      body,
      prompt,
      error: `prompt must be at most ${MAX_PROMPT_CHARS} characters`
    }
  }
  if (body.n !== undefined && body.n !== 1) {
    return { body, prompt, error: "only n=1 is supported" }
  }
  if (
    body.response_format !== undefined &&
    body.response_format !== "b64_json"
  ) {
    return {
      body,
      prompt,
      error: "only response_format='b64_json' is supported"
    }
  }
  return { body, prompt }
}

const bindRequestAbort = (
  request: RouteRequest,
  response: ServerResponse
): AbortController => {
  const abortController = new AbortController()
  request.raw.once("aborted", () => abortController.abort())
  response.once("close", () => {
    if (!response.writableEnded) abortController.abort()
  })
  return abortController
}

const generateImages = async ({
  backend,
  config,
  lock,
  target,
  prompt,
  abortController
}: {
  backend: AgentBackend & {
    generateImage: NonNullable<AgentBackend["generateImage"]>
  }
  config: ProxyConfig
  lock: RequestQueue
  target: ResolvedModelTarget
  prompt: string
  abortController: AbortController
}): Promise<GeneratedImage[]> => {
  const images = await lock(
    async (queueSignal) => {
      const abortFromQueue = () => abortController.abort(queueSignal.reason)
      queueSignal.addEventListener("abort", abortFromQueue, { once: true })
      try {
        await backend.ensureReady()
        return await backend.generateImage({
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

  return images
    .map(normalizeImage)
    .filter((image): image is GeneratedImage => image !== null)
}

const classifyImageFailure = (
  error: unknown,
  aborted: boolean
): { status: number; message: string; type: string } => {
  const message = (error as Error).message
  const timedOut = aborted && /Request timeout/.test(message)
  if (error instanceof QueueStalledError) {
    return { status: 503, message, type: "ServiceUnavailable" }
  }
  if (timedOut) {
    return { status: 504, message: "Image generation timed out", type: "Timeout" }
  }
  if (aborted) {
    return {
      status: 499,
      message: "Image generation was cancelled",
      type: "Cancelled"
    }
  }
  if (error instanceof BackendInputError) {
    return { status: 400, message, type: "BadRequest" }
  }
  return { status: 502, message, type: "ImageGenerationError" }
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
    const parsed = parseImageRequest(request.body)
    if (parsed.error) {
      sendJson(response, 400, badRequest(parsed.error))
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

    const target = await backend.resolveModel(parsed.body.model)
    if ("error" in target) {
      sendJson(response, 400, badRequest(target.error))
      return
    }

    const abortController = bindRequestAbort(request, response)
    const imageBackend = backend as AgentBackend & {
      generateImage: NonNullable<AgentBackend["generateImage"]>
    }

    try {
      const images = await generateImages({
        backend: imageBackend,
        config,
        lock,
        target,
        prompt: parsed.prompt,
        abortController
      })
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
      if (abortController.signal.aborted && response.writableEnded) return
      const failure = classifyImageFailure(
        error,
        abortController.signal.aborted
      )
      sendJson(response, failure.status, {
        error: { message: failure.message, type: failure.type }
      })
    }
  })
}
