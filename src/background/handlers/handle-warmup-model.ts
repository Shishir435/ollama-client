import { safeSendResponse } from "@/background/lib/utils"
import { DEFAULT_MODEL_CONFIG, STORAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { ProviderFactory } from "@/lib/providers/factory"
import { ProviderId } from "@/lib/providers/types"
import type { ModelConfigMap, SendResponseFunction } from "@/types"

type WarmupPayload = {
  model: string
  previousModel?: string
}

const warmupHistory = new Map<string, number>()

const parseKeepAliveMs = (
  value?: string | number
): number | undefined => {
  if (value === undefined || value === null) return undefined
  if (typeof value === "number") return Math.max(0, value) * 1000

  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10) * 1000
  }
  const match = trimmed.match(/^(\d+)(ms|s|m|h)$/i)
  if (!match) return undefined
  const amount = Number.parseInt(match[1], 10)
  const unit = match[2].toLowerCase()
  if (Number.isNaN(amount) || amount < 0) return undefined
  if (unit === "ms") return amount
  if (unit === "s") return amount * 1000
  if (unit === "m") return amount * 60 * 1000
  if (unit === "h") return amount * 60 * 60 * 1000
  return undefined
}

const getModelConfig = async (model: string) => {
  const configs =
    (await plasmoGlobalStorage.get<ModelConfigMap>(
      STORAGE_KEYS.PROVIDER.MODEL_CONFIGS
    )) ?? {}
  return {
    ...DEFAULT_MODEL_CONFIG,
    ...(configs[model] ?? {})
  }
}

const DEFAULT_WARMUP_COOLDOWN_MS = 5 * 60 * 1000

const shouldWarmup = (model: string, keepAliveMs?: number) => {
  if (keepAliveMs === 0) return false
  const last = warmupHistory.get(model)
  if (!last) return true
  const windowMs = keepAliveMs ?? DEFAULT_WARMUP_COOLDOWN_MS
  return Date.now() - last > windowMs / 2
}

const warmupModel = async (model: string, keepAlive?: string | number) => {
  const provider = await ProviderFactory.getProviderForModel(model)
  if (provider.id !== ProviderId.OLLAMA) return

  const baseUrl = provider.config.baseUrl || "http://localhost:11434"

  await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt: "",
      stream: false,
      keep_alive: keepAlive
    })
  })
}

const unloadModel = async (model: string) => {
  const provider = await ProviderFactory.getProviderForModel(model)
  if (provider.id !== ProviderId.OLLAMA) return

  const baseUrl = provider.config.baseUrl || "http://localhost:11434"

  await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [],
      keep_alive: 0
    })
  })
}

export const handleWarmupModel = async (
  payload: WarmupPayload,
  sendResponse: SendResponseFunction
): Promise<void> => {
  if (!payload?.model) {
    safeSendResponse(sendResponse, {
      success: false,
      error: { status: 400, message: "Missing model name" }
    })
    return
  }

  try {
    const config = await getModelConfig(payload.model)
    const keepAliveMs = parseKeepAliveMs(config.keep_alive)

    if (config.warm_on_select && shouldWarmup(payload.model, keepAliveMs)) {
      await warmupModel(payload.model, config.keep_alive)
      warmupHistory.set(payload.model, Date.now())
      logger.info("Model warmup triggered", "WarmupModel", {
        model: payload.model
      })
    }

    if (
      payload.previousModel &&
      payload.previousModel !== payload.model
    ) {
      const previousConfig = await getModelConfig(payload.previousModel)
      if (previousConfig.unload_on_switch) {
        await unloadModel(payload.previousModel)
        logger.info("Model unloaded on switch", "WarmupModel", {
          model: payload.previousModel
        })
      }
    }

    safeSendResponse(sendResponse, { success: true })
  } catch (error) {
    logger.warn("Warmup model failed", "WarmupModel", { error })
    safeSendResponse(sendResponse, {
      success: false,
      error: {
        status: 0,
        message: error instanceof Error ? error.message : String(error)
      }
    })
  }
}
