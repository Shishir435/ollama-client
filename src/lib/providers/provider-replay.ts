import { createAppError } from "@/lib/error-utils"
import type { ProviderReplayArtifact } from "@/types/chat"
import { ProviderReplayArtifactSchema } from "@/types/chat.schemas"

const REPLAY_ARTIFACT_VERSION = 1 as const

type ReplayWire = ProviderReplayArtifact["wire"]
type ReplayBlock = ProviderReplayArtifact["blocks"][number]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)

const artifactIsValid = (
  artifact: unknown
): artifact is ProviderReplayArtifact =>
  ProviderReplayArtifactSchema.safeParse(artifact).success

const invalidReplayError = () =>
  createAppError(
    "Saved provider continuation data is invalid. Retry this turn to continue safely.",
    {
      kind: "validation",
      messageKey: "chat.errors.provider_replay_invalid"
    }
  )

export const createProviderReplayArtifact = (
  wire: ReplayWire,
  providerId: string,
  model: string,
  blocks: ReplayBlock[]
): ProviderReplayArtifact => {
  const artifact: ProviderReplayArtifact = {
    version: REPLAY_ARTIFACT_VERSION,
    wire,
    providerId,
    model,
    blocks
  }
  if (!artifactIsValid(artifact)) throw invalidReplayError()
  return artifact
}

/**
 * Return validated replay blocks only to the adapter that created them.
 * Artifacts from another provider/model are ordinary history and are ignored;
 * a malformed matching artifact fails locally instead of reaching upstream.
 */
export const getProviderReplayBlocks = (
  artifact: ProviderReplayArtifact | undefined,
  expected: { wire: ReplayWire; providerId: string; model: string }
): ReplayBlock[] | undefined => {
  if (!artifact) return undefined
  if (!isRecord(artifact)) throw invalidReplayError()
  if (
    artifact.wire !== expected.wire ||
    artifact.providerId !== expected.providerId ||
    artifact.model !== expected.model
  ) {
    return undefined
  }
  if (!artifactIsValid(artifact)) throw invalidReplayError()
  return artifact.blocks
}

export const parseStoredReplayArtifact = (
  raw: unknown
): ProviderReplayArtifact | undefined => {
  if (typeof raw !== "string" || raw.length === 0) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    return artifactIsValid(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

export const serializeReplayArtifact = (
  artifact: ProviderReplayArtifact | undefined
): string | null => {
  if (!artifact) return null
  if (!artifactIsValid(artifact)) throw invalidReplayError()
  return JSON.stringify(artifact)
}
